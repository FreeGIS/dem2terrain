const gdal = require('gdal');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { prettyTime, uuid } = require('./util');
const { reprojectImage } = require('./gdal-util');
const { mapboxDem, terrariumDem } = require('./dem-encode');
const CoordinateSys = require('./coordinateSys');
const ProgressBar = require('./progressbar/index');

// 创建一个线程池
const workerFarm = require('./workfarm/index');
const workers = workerFarm(require.resolve('./createtile'), ['createTile', 'closeDataset']);

let childPids = new Set();
const progressBar = new ProgressBar(60, '进度');
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
 *   tileCount: number;
 *   overviewInfos: OverviewInfoDict;
 *   levelInfo: LevelInfoDict;
 *   completeCount: number;
 * }} StatisticsInfo
 * 
 * @type {StatisticsInfo}
 */
const statistics = {
  tileCount: 0,
  completeCount: 0,
  overviewInfos: {},
  levelInfo: {},
}

/**
 * 
 * @param {import('gdal').Dataset} sourceDataset gdal 直接读取的数据集 
 * @param {'mapbox' | 'terrarium'} encoding 编码格式
 * @returns {{
 *   encodeDataset: import('gdal').Dataset;
 *   encodedDatasetPath: string;
 * }} 编码后的数据集与临时文件路径
 */
const encodeDataset = (
  sourceDataset,
  encoding,
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
  const rChannelBuffer = new Uint8Array(sourceWidth * sourceHeight);
  const gChannelBuffer = new Uint8Array(sourceWidth * sourceHeight);
  const bChannelBuffer = new Uint8Array(sourceWidth * sourceHeight);
  // 循环高程，转rgb编码
  if (encoding === 'mapbox') {
    heightBuffer.forEach((height, i) => {
      const color = mapboxDem.encode(height);
      rChannelBuffer[i] = color[0];
      gChannelBuffer[i] = color[1];
      bChannelBuffer[i] = color[2];
    })
  } else if (encoding === 'terrarium') {
    heightBuffer.forEach((height, i) => {
      const color = terrariumDem.encode(height);
      rChannelBuffer[i] = color[0];
      gChannelBuffer[i] = color[1];
      bChannelBuffer[i] = color[2];
    })
  }

  // 写入像素值
  encodedDataset.bands.get(1).pixels.write(0, 0, sourceWidth, sourceHeight, rChannelBuffer);
  encodedDataset.bands.get(2).pixels.write(0, 0, sourceWidth, sourceHeight, gChannelBuffer);
  encodedDataset.bands.get(3).pixels.write(0, 0, sourceWidth, sourceHeight, bChannelBuffer);
  // 刷入磁盘
  encodedDataset.flush();

  return {
    encodedDataset,
    encodedDatasetPath,
  };
}

/**
 * 重投影数据集
 * @param {import('gdal').Dataset} encodedDataset 
 * @param {number} epsg 
 * @returns {{
 *   dataset: import('gdal').Dataset;
 *   projectDatasetPath: string;
 * }}
 */
const project = (encodedDataset, epsg) => {
  let sourceEPSG = encodedDataset.srs.getAuthorityCode();
  let projectDatasetPath = void 0;
  let dataset;
  if (sourceEPSG !== epsg) {
    // 数据源坐标系与目标坐标系不一致，需要预先投影 
    projectDatasetPath = path.join(os.tmpdir(), `${uuid()}.tif`);
    // 地形编码，非普通影像，采用最近邻采样重投影，避免出现尖尖问题
    reprojectImage(encodedDataset, projectDatasetPath, epsg, 6);
    dataset = gdal.open(projectDatasetPath, 'r');
  } else {
    dataset = encodedDataset;
  }
  // encode_ds会重投影，到此该数据集已经失去作用了，直接关闭！
  if (sourceEPSG !== epsg) {
    encodedDataset.close(projectDatasetPath);
  }
  return {
    projectDatasetPath,
    dataset
  }
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

  /**
   * @type {number[]}
   */
  let overviews = [];
  for (let i = adjustZoom - 1; i >= minZoom; i--) {
    const factor = Math.pow(2, adjustZoom - i);
    overviews.push(factor);
    // zoom级别对应overviews索引
    statistics.overviewInfos[i] = {
      index: adjustZoom - i - 1,
      startX: dataset.geoTransform[0],
      startY: dataset.geoTransform[3],
      width: Math.ceil(dataset.rasterSize.x * 1.0 / factor),
      height: Math.ceil(dataset.rasterSize.y * 1.0 / factor),
      resX: dataset.geoTransform[1] * factor,
      resY: dataset.geoTransform[5] * factor
    };
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
function main(tifFilePath, outputDir, options) {
  // 计时开始
  const startTime = globalThis.performance.now();
  // 结构可选参数
  const { minZoom, maxZoom, epsg, tileSize, encoding } = options;
  coordinateSys = new CoordinateSys(epsg);
  const sourceDataset = gdal.open(tifFilePath, 'r');
  //#region 步骤 1 - 高程值转 RGB，重新编码
  const {
    encodedDataset,
    encodedDatasetPath,
  } = encodeDataset(sourceDataset, encoding)
  console.log(`>> 步骤1: 重编码 - 完成`);
  //#endregion

  //#region 步骤 2 - 影像重投影
  const {
    dataset,
    projectDatasetPath,
  } = project(encodedDataset, epsg)
  console.log(`>> 步骤2: 重投影至 EPSG:${epsg} - 完成`);
  //#endregion

  //#region 步骤 3 - 建立影像金字塔 由于地形通常是30m 90m精度
  const adjustZoom = buildPyramid(dataset, minZoom);
  console.log('>> 步骤3: 构建影像金字塔索引 - 完成');
  //#endregion

  //#region 步骤4 - 切片
  const ominx = dataset.geoTransform[0];
  const omaxx = dataset.geoTransform[0] + dataset.rasterSize.x * dataset.geoTransform[1];
  const omaxy = dataset.geoTransform[3];
  const ominy = dataset.geoTransform[3] + dataset.rasterSize.y * dataset.geoTransform[5];

  // 计算切片总数
  for (let tz = minZoom; tz <= maxZoom; ++tz) {
    const minTileXY = coordinateSys.point2Tile(ominx, ominy, tz);
    const maxTileXY = coordinateSys.point2Tile(omaxx, omaxy, tz);
    const tminx = Math.max(0, minTileXY.tileX);
    const tminy = Math.max(0, minTileXY.tileY);
    let tmaxx;
    if(epsg===3857){
      tmaxx = Math.min(Math.pow(2, tz) - 1, maxTileXY.tileX);
      tmaxy = Math.min(Math.pow(2, tz) - 1, maxTileXY.tileY);
    } else {
      tmaxx = Math.min(Math.pow(2, tz+1) - 1, maxTileXY.tileX);
      tmaxy = Math.min(Math.pow(2, tz+1) - 1, maxTileXY.tileY);
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
      overviewInfo = {
        startX: dataset.geoTransform[0],
        startY: dataset.geoTransform[3],
        resX: dataset.geoTransform[1],
        resY: dataset.geoTransform[5],
        width: dataset.rasterSize.x,
        height: dataset.rasterSize.y
      }
    } else {
      overviewInfo = statistics.overviewInfos[tz];
    }
    for (let i = tminy; i <= tmaxy; i++) {
      // mapbox地形只认 xyz，不认tms，故直接写死
      const ytile = getYtile(i, tz, true);
      for (let j = tminx; j <= tmaxx; j++) {
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
          dsPath: projectDatasetPath,
          x: j,
          y: ytile,
          z: tz,
          outputTile: outputDir
        };
        workers.createTile(createInfo, function (err, pid) {
          if (err) {
            console.log(err);
          }
          childPids.add(pid);
          statistics.completeCount++;

          // 更新进度条
          progressBar.render(statistics.completeCount);
          if (statistics.completeCount === statistics.tileCount) {
            const endTime = globalThis.performance.now()
            const {
              resultTime,
              unit
            } = prettyTime(endTime - startTime)
            console.log(`\n\n转换完成，用时 ${resultTime.toFixed(2)} ${unit}。`)
            // 关闭所有的数据源
            dataset.close();
            //循环关闭子进程的ds，否则临时文件被占用删除不了
            const call = {
              method: 'closeDataset',
              callback: function (_, closePid) {
                childPids.delete(closePid);
                if (childPids.size === 0) {
                  // 关闭子进程任务
                  workerFarm.end(workers);
                  // 删除临时文件
                  fs.unlinkSync(encodedDatasetPath);
                  if (projectDatasetPath !== undefined)
                    fs.unlinkSync(projectDatasetPath);
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
module.exports = main;