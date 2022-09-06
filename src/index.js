const gdal = require('gdal-async');
const fs = require('fs');
const path = require('path');
const process = require('process');
const os = require('os');
const { prettyTime, uuid, wait, mkdirsSync, emptyDir } = require('./util');
const { reprojectImage } = require('./gdal-util');
const { mapboxDem, terrariumDem } = require('./dem-encode');
const CoordinateSys = require('./coordinateSys');
const ProgressBar = require('./progressbar/index');
const { mb_open, mb_stop_writing, mb_put_tile } = require('./mbtiles-util');
// 创建一个线程池
const workerFarm = require('./workfarm/index');
const workers = workerFarm(require.resolve('./createtile'), ['createTile', 'closeDataset']);

let childPids = new Set();
let progressBar;
let coordinateSys;
/**
 * @typedef {{
 *   tminx: number;
 *   tminy: number;
 *   tmaxx: number;
 *   tmaxy: number;
 * }} LevelInfo
 * 
 * @typedef {{
 *   [key: number]: LevelInfo;
 * }} LevelInfoDict
 * 
 * @typedef {{
 *   index: number;
 *   startX: number;
 *   startY: number;
 *   width:number;
 *   height:number;
 *   resX:number;
 *   resY:number;
 * }} OverviewInfo
 * 
 * @typedef {{
 *   [key: number]: OverviewInfo;
 * }} OverviewInfoDict
 */

/**
 * @typedef {{
 *  ds: import('gdal').Dataset;
 *  path: string;
 * }} DsInfo
 * 
 * @typedef {{
 *   tileCount: number;
 *   overviewInfos: OverviewInfoDict;
 *   levelInfo: LevelInfoDict;
 *   completeCount: number;
 * }} StatisticsInfo
 * 
 * @type {StatisticsInfo}
 */
let statistics = {
  tileCount: 0,
  completeCount: 0,
  overviewInfos: {},
  levelInfo: {}
}
process.on('SIGINT', function () {
  console.log('\n\n>> 清理临时文件中...');
  if (encodedDsInfo !== null)
    clearDsInfo(encodedDsInfo);
  if (projectDsInfo !== null)
    clearDsInfo(projectDsInfo);
  console.log('>> 清理临时文件 - 完成');
  process.exit();
});
/**
 * 
 * @param {DsInfo} dsinfo 数据集的元数据信息
 */
function clearDsInfo(dsinfo) {
  if (dsinfo === null)
    return;
  // ds未关闭，强制关闭
  dsinfo.ds.close();
  // 存在临时文件，强制删除
  if (fs.existsSync(dsinfo.path))
    fs.unlinkSync(dsinfo.path);
  // 存在临时影像金字塔附属文件
  const ovrPath = dsinfo.path + '.ovr';
  if (fs.existsSync(ovrPath))
    fs.unlinkSync(ovrPath);
  dsinfo = null;
}
/**
 * 
 * @param {import('gdal').Dataset} sourceDataset gdal 直接读取的数据集 
 * @param {'mapbox' | 'terrarium'} encoding 编码格式
 * @returns {DsInfo} 编码后的数据集
 */
const encodeDataset = (
  sourceDataset,
  encoding
) => {
  const sourceWidth = sourceDataset.rasterSize.x;
  const sourceHeight = sourceDataset.rasterSize.y;

  const bandOneHeight = sourceDataset.bands.get(1);
  const heightBuffer = new Int16Array(sourceWidth * sourceHeight);
  // 地形是GDT_Int16 读取所有像素
  const dataType = gdal.GDT_Int16;
  bandOneHeight.pixels.read(0, 0, sourceWidth, sourceHeight, heightBuffer, {
    buffer_width: sourceWidth,
    buffer_height: sourceHeight,
    data_type: dataType
  });

  // 创建编码转换的栅格文件
  const sourceDataDriver = sourceDataset.driver;
  const encodedDatasetPath = path.join(os.tmpdir(), `${uuid()}.tif`);
  const encodedDataset = sourceDataDriver.create(
    encodedDatasetPath,
    sourceWidth,
    sourceHeight,
    3,
    dataType
  );
  encodedDataset.srs = sourceDataset.srs;
  encodedDataset.geoTransform = sourceDataset.geoTransform;
  const channelLength = sourceWidth * sourceHeight;
  const rChannelBuffer = new Uint8Array(channelLength);
  const gChannelBuffer = new Uint8Array(channelLength);
  const bChannelBuffer = new Uint8Array(channelLength);
  function forEachHeightBuffer(heightBuffer, encode) {
    const TEMPCOLOR = [1, 1, 1];
    for (let i = 0, len = heightBuffer.length; i < len; i++) {
      if (encode) {
        const color = encode(heightBuffer[i], TEMPCOLOR);
        rChannelBuffer[i] = color[0];
        gChannelBuffer[i] = color[1];
        bChannelBuffer[i] = color[2];
      }
    }
  }
  // 循环高程，转rgb编码
  if (encoding === 'mapbox') {
    forEachHeightBuffer(heightBuffer, mapboxDem.encode);
  } else if (encoding === 'terrarium') {
    forEachHeightBuffer(heightBuffer, terrariumDem.encode);
  }

  // 写入像素值
  encodedDataset.bands.get(1).pixels.write(0, 0, sourceWidth, sourceHeight, rChannelBuffer);
  encodedDataset.bands.get(2).pixels.write(0, 0, sourceWidth, sourceHeight, gChannelBuffer);
  encodedDataset.bands.get(3).pixels.write(0, 0, sourceWidth, sourceHeight, bChannelBuffer);
  // 刷入磁盘
  encodedDataset.flush();
  return {
    ds: encodedDataset,
    path: encodedDatasetPath
  };
}

/**
 * 重投影数据集
 * @param {import('gdal').Dataset} encodedDataset 
 * @param {number} epsg 
 * @returns {
 *   dataset: import('gdal').Dataset
 * }
 */
const project = (encodedDataset, epsg) => {
  let projectDatasetPath = path.join(os.tmpdir(), `${uuid()}.tif`);
  // 地形编码，非普通影像，采用最近邻采样重投影，避免出现尖尖问题
  reprojectImage(encodedDataset, projectDatasetPath, epsg, 6);
  let dataset = gdal.open(projectDatasetPath, 'r');
  return {
    ds: dataset,
    path: projectDatasetPath
  };
}


/**
 * 
 * @param {import('gdal').Dataset} dataset
 * @param {number} minZoom
 * 
 * @returns {number} adjustZoom
 */
const buildPyramid = (
  dataset,
  minZoom,
) => {
  const datasetResolution = dataset.geoTransform[1]; // 使用resx替代整个影像的分辨率
  // 根据ds_res查询出适配的最大的zoom级别
  let adjustZoom = 1;
  for (; adjustZoom < 20; adjustZoom++) {
    let high = coordinateSys.getResolutionByZoom(adjustZoom);
    let low = coordinateSys.getResolutionByZoom(adjustZoom + 1);
    if (datasetResolution < high && datasetResolution >= low) {
      break;
    }
  }

  // ds如果能塞进一个Tile（256*256），就不用再细分overviewInfo下去
  const maxPixel = Math.max(dataset.rasterSize.x, dataset.rasterSize.y) * 1.0;

  /**
   * @type {number[]}
   */
  let overviews = [], factor, overviewInfo, isCalOverInfo = true;
  for (let i = adjustZoom - 1; i >= minZoom; i--) {
    if (isCalOverInfo) {
      factor = Math.pow(2, adjustZoom - i);
      overviews.push(factor);
      // zoom级别对应overviews索引
      overviewInfo = {
        index: adjustZoom - i - 1,
        startX: dataset.geoTransform[0],
        startY: dataset.geoTransform[3],
        width: Math.ceil(dataset.rasterSize.x * 1.0 / factor),
        height: Math.ceil(dataset.rasterSize.y * 1.0 / factor),
        resX: dataset.geoTransform[1] * factor,
        resY: dataset.geoTransform[5] * factor
      };
    }
    statistics.overviewInfos[i] = overviewInfo;
    // 单个Tile是256*256的，如果raster几轮缩小，已经小于单张Tile，就不再缩小了。
    if (isCalOverInfo === true && maxPixel / factor < 256)
      isCalOverInfo = false;
  }
  dataset.buildOverviews('NEAREST', overviews);
  return adjustZoom
}
/**
 * 
 * @param {string} tifFilePath TIF 文件路径
 * @param {string} outputDir 输出目录
 * @param {{
 *   minZoom: number;
 *   maxZoom: number;
 *   epsg: number;
 *   tileSize: 256 | 512;
 *   encoding: 'mapbox' | 'terrarium';
 * }} options 可选配置
 */
async function main(input, output, options) {
  // 计时开始
  const startTime = global.performance.now();
  // 结构可选参数
  // 结构可选参数
  const { minZoom, maxZoom, epsg, tileSize, encoding, isClean } = options;
  // 判断是否以mbtiles转储
  const isSavaMbtiles = (path.extname(output) === '.mbtiles');
  // 定义切片临时输出目录
  let outputDir = output;
  // 如果以mbtiles存储重定向为临时目录
  if (isSavaMbtiles === true)
    outputDir = path.join(os.tmpdir(), uuid());

  let stepIndex = 0;
  //#region 步骤 1 - 高程值转 RGB，重新编码
  if (isClean === 1) {
    if (isSavaMbtiles === true && fs.existsSync(output))
      fs.unlinkSync(output);
    else
      emptyDir(output);
    console.log(`>> 步骤${++stepIndex}: 清空输出文件夹 - 完成`);
  }

  //#endregion
  coordinateSys = new CoordinateSys(epsg);
  const sourceDataset = gdal.open(input, 'r');
  //#region 步骤 1 - 高程值转 RGB，重新编码
  encodedDsInfo = encodeDataset(sourceDataset, encoding);
  sourceDataset.close();
  console.log(`>> 步骤${++stepIndex}: 重编码 - 完成`);
  //#endregion
  //#region 步骤 2 - 影像重投影
  let dataset;
  let encodeDs = encodedDsInfo.ds;
  if (encodeDs.srs.getAuthorityCode() !== epsg) {
    projectDsInfo = project(encodeDs, epsg);
    dataset = projectDsInfo.ds;
  } else {
    dataset = encodeDs;
  }
  console.log(`>> 步骤${++stepIndex}: 重投影至 EPSG:${epsg} - 完成`);
  //#endregion


  //#region 步骤 3 - 建立影像金字塔 由于地形通常是30m 90m精度
  const adjustZoom = buildPyramid(dataset, minZoom);
  console.log(`>> 步骤${++stepIndex}: 构建影像金字塔索引 - 完成`);
  //#endregion

  //#region 步骤4 - 切片
  const dsInfo = {
    width: dataset.rasterSize.x,
    height: dataset.rasterSize.y,
    resX: dataset.geoTransform[1],
    resY: dataset.geoTransform[5],
    startX: dataset.geoTransform[0],
    startY: dataset.geoTransform[3],
    endX: dataset.geoTransform[0] + dataset.rasterSize.x * dataset.geoTransform[1],
    endY: dataset.geoTransform[3] + dataset.rasterSize.y * dataset.geoTransform[5],
    path: dataset.description
  }
  // 计算切片总数
  // 堆积任务数量
  let pileUpCount = 0;
  for (let tz = minZoom; tz <= maxZoom; ++tz) {
    const miny = Math.min(dsInfo.startY, dsInfo.endY);
    const maxy = Math.max(dsInfo.startY, dsInfo.endY);
    const minTileXY = coordinateSys.point2Tile(dsInfo.startX, miny, tz);
    const maxTileXY = coordinateSys.point2Tile(dsInfo.endX, maxy, tz);
    const tminx = Math.max(0, minTileXY.tileX);
    const tminy = Math.max(0, minTileXY.tileY);
    let tmaxx;
    if (epsg === 3857) {
      tmaxx = Math.min(Math.pow(2, tz) - 1, maxTileXY.tileX);
      tmaxy = Math.min(Math.pow(2, tz) - 1, maxTileXY.tileY);
    } else {
      tmaxx = Math.min(Math.pow(2, tz + 1) - 1, maxTileXY.tileX);
      tmaxy = Math.min(Math.pow(2, tz + 1) - 1, maxTileXY.tileY);
    }
    statistics.tileCount += (tmaxy - tminy + 1) * (tmaxx - tminx + 1);
    statistics.levelInfo[tz] = {
      tminx,
      tminy,
      tmaxx,
      tmaxy
    };
  }
  // 设置进度条任务总数
  progressBar = new ProgressBar(60, `>> 步骤${++stepIndex}`);
  progressBar.setTaskTotal(statistics.tileCount)
  // 实际裙边有1像素 256+1+1 上下左右各1像素
  // 裙边所需的缩放
  let offset = 0
  let outTileSize = tileSize;
  if (encoding === 'mapbox') {
    offset = 256.0 / tileSize;
    outTileSize = tileSize + 2;
  }
  for (let tz = minZoom; tz <= maxZoom; tz++) {
    const { tminx, tminy, tmaxx, tmaxy } = statistics.levelInfo[tz];
    /**
     * @type {OverviewInfo}
     */
    let overviewInfo;
    // 根据z获取宽高和分辨率信息
    if (tz >= adjustZoom) {
      overviewInfo = dsInfo;
    } else {
      overviewInfo = statistics.overviewInfos[tz];
    }
    for (let j = tminx; j <= tmaxx; j++) {
      // 递归创建目录
      mkdirsSync(path.join(outputDir, tz.toString(), j.toString()));
      for (let i = tminy; i <= tmaxy; i++) {
        // mapbox地形只认 xyz，不认tms，故直接写死
        const ytile = getYtile(i, tz, true);
        // 由于裙边让周围多了1像素，由于切片是把xyz的地理范围数据编码到512上，所以256这里就是1，512这里就是0.5
        const tileBound = coordinateSys.tileBounds(j, i, tz, offset);
        const { rb, wb } = geoQuery(
          overviewInfo,
          tileBound.xMin,
          tileBound.yMax,
          tileBound.xMax,
          tileBound.yMin,
          outTileSize
        );
        const createInfo = {
          outTileSize,
          overviewInfo,
          rb,
          wb,
          dsPath: dsInfo.path,
          x: j,
          y: ytile,
          z: tz,
          outputTile: outputDir
        };
        pileUpCount++;
        if (pileUpCount > 500)
          await wait(1000);
        workers.createTile(createInfo, async function (err, pid) {
          if (err) {
            console.log(err);
          }
          childPids.add(pid);
          statistics.completeCount++;
          pileUpCount--;
          // 更新进度条
          progressBar.render(statistics.completeCount);
          if (statistics.completeCount === statistics.tileCount) {
            // 转储mbtiles
            if (isSavaMbtiles === true) {
              await importMbtiles(outputDir, output);
              console.log(`\n>> 步骤${++stepIndex}: 转储mbtiles - 完成`);
            }
            const endTime = global.performance.now()
            const {
              resultTime,
              unit
            } = prettyTime(endTime - startTime)
            console.log(`\n\n转换完成，用时 ${resultTime.toFixed(2)} ${unit}。`)
            //循环关闭子进程的ds，否则临时文件被占用删除不了
            const call = {
              method: 'closeDataset',
              callback: function (_, closePid) {
                childPids.delete(closePid);
                if (childPids.size === 0) {
                  // 关闭子进程任务
                  workerFarm.end(workers);
                  // 清除数据源信息
                  clearDsInfo(encodedDsInfo);
                  clearDsInfo(projectDsInfo);
                  resetStats();
                }
              },
              args: [],
              retries: 0
            }
            // 循环调用，关闭子进程资源
            for (let childId in workers.farm.children) {
              workers.farm.send(childId, call);
            }
          }
        })
      }
    }
  }
  //#endregion
}

const resetStats = () => {
  statistics.tileCount = 0;
  statistics.completeCount = 0;
  statistics.levelInfo = {};
  statistics.overviewInfos = {};
  statistics.encodedDsInfo = undefined;
  statistics.projectDsInfo = undefined;
}
// 重构使其支持影像金字塔查询
/**
 * 
 * @param {OverviewInfo} overviewInfo 
 * @param {number} ulx 
 * @param {number} uly 
 * @param {number} lrx 
 * @param {number} lry 
 * @param {number} [querysize=0] 
 * @returns {{
 *   rb: { 
 *     rx: number; 
 *     ry: number; 
 *     rxsize: number; 
 *     rysize: number;
 *   };
 *   wb: { 
 *     wx: number; 
 *     wy: number; 
 *     wxsize: number; 
 *     wysize: number;
 *   };
 * }}
 */
function geoQuery(overviewInfo, ulx, uly, lrx, lry, querysize = 0) {
  const { startX, startY, width, height, resX, resY } = overviewInfo;
  // 根据金字塔级别，重置分辨率，重置宽高
  let rx = Math.floor((ulx - startX) / resX + 0.001);
  let ry = Math.floor((uly - startY) / resY + 0.001);
  let rxsize = Math.max(1, Math.floor((lrx - ulx) / resX + 0.5));
  let rysize = Math.max(1, Math.floor((lry - uly) / resY + 0.5));
  let wxsize, wysize;
  if (!querysize) {
    wxsize = rxsize;
    wysize = rysize;
  } else {
    wxsize = querysize;
    wysize = querysize;
  }
  let wx = 0;
  if (rx < 0) {
    let rxshift = Math.abs(rx);
    wx = Math.floor(wxsize * (rxshift * 1.0 / rxsize));
    wxsize = wxsize - wx;
    rxsize = rxsize - Math.floor(rxsize * (rxshift * 1.0 / rxsize));
    rx = 0;
  }
  if ((rx + rxsize) > width) {
    wxsize = Math.floor(wxsize * (width - rx) * 1.0 / rxsize);
    rxsize = width - rx;
  }
  let wy = 0;
  if (ry < 0) {
    const ryshift = Math.abs(ry);
    wy = Math.floor(wysize * (ryshift * 1.0 / rysize));
    wysize = wysize - wy;
    rysize = rysize - Math.floor(rysize * (ryshift * 1.0 / rysize));
    ry = 0;
  }
  if ((ry + rysize) > height) {
    wysize = Math.floor(wysize * (height - ry) * 1.0 / rysize);
    rysize = height - ry;
  }
  return {
    rb: { rx, ry, rxsize, rysize },
    wb: { wx, wy, wxsize, wysize }
  }
}

/**
 * 根据tms或xyz策略修正Y的实际值
 * @param {number} ty 
 * @param {number} tz 
 * @param {boolean} tms2xyz 
 * @returns {number}
 */
function getYtile(ty, tz, tms2xyz = true) {
  if (tms2xyz)
    return Math.pow(2, tz) - 1 - ty;
  return ty;
}


/**
 * 将目录里的切片导入mbtiles，删除文件目录
 * @param {number} tileDir 
 * @param {number} mbtilesPath 
 * @returns {Promise}
 */
function importMbtiles(tileDir, mbtilesPath) {
  return new Promise(async (res, rej) => {
    let mbtiles = await mb_open(mbtilesPath, 'rwc');
    // 遍历tile目录的tile，并转储至mbtiles
    let z, x, y;
    const zFolds = fs.readdirSync(tileDir);
    const zCount = zFolds.length;
    for (let i = 0; i < zCount; i++) {
      let zFold = zFolds[i];
      z = Number(zFold);
      const zPath = path.join(tileDir, zFold);
      // 遍历z下的x文件夹
      const xFolds = fs.readdirSync(zPath);
      const xCount = xFolds.length;
      for (let j = 0; j < xCount; j++) {
        let xFold = xFolds[j];
        x = Number(xFold);
        // 遍历x文件夹下的y文件
        const xPath = path.join(zPath, xFold);
        const yFiles = fs.readdirSync(xPath);

        const yCount = yFiles.length;
        // 每10个一批写入，否则sqlite容易报错database lock
        let promises = [];
        for (let k = 0; k < yCount; k++) {
          const yFile = yFiles[k];
          y = Number(yFile.split('.')[0]);
          const yPath = path.join(xPath, yFile);
          promises.push(mb_put_tile(mbtiles, z, x, y, yPath));
        }
        await Promise.all(promises);
        promises = [];
        // 删除目录
        fs.rmdirSync(xPath);
      }
      fs.rmdirSync(zPath);
    }
    fs.rmdirSync(tileDir);
    await mb_stop_writing(mbtiles);
    res('import');
  });
}
module.exports = main;