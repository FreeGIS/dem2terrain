const gdal = require('gdal-async');
const fs = require('fs');
const path = require('path');
const process = require('process');
const os = require('os');
const { prettyTime, uuid, wait, mkdirsSync, emptyDir } = require('./util');
const { reprojectImage, getBuildOverviewResampling } = require('./gdal-util');
const ProgressBar = require('./progressbar/index');
const { mb_open, mb_stop_writing, mb_put_tile } = require('./mbtiles-util');
// 创建一个线程池
const workerFarm = require('./workfarm/index');
const workers = workerFarm(require.resolve('./createtile'), ['createTile', 'closeDataset']);
const { tileBoundMap, ST_TileEnvelope, getTileByCoors } = require('./tile-util');
let childPids = new Set();
let progressBar;
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
 *   levelInfo: LevelInfoDict;
 *   completeCount: number;
 * }} StatisticsInfo
 * 
 * @type {StatisticsInfo}
 */
let statistics = {
  tileCount: 0,
  completeCount: 0,
  levelInfo: {}
}
process.on('SIGINT', function () {
  console.log('\n\n>> 清理临时文件中...');
  recycle();
  console.log('>> 清理临时文件 - 完成');
  process.exit();
});


function recycle() {
  if (sourceDs !== null) {
    try {
      sourceDs.close();
    } catch (e) { }
    sourceDs = null;
  }
  if (projectDs !== null) {
    try {
      projectDs.close();
    } catch (e) { }
    projectDs = null;
  }
  /*if (encodeDs !== null) {
    try {
      encodeDs.close();
    } catch (e) { }
    encodeDs = null;
  }*/
  // 存在临时文件，强制删除
  if (fs.existsSync(projectPath)) {
    fs.unlinkSync(projectPath);
    projectPath = null;
  }
  if (fs.existsSync(encodePath)) {
    fs.unlinkSync(encodePath);
    encodePath = null;
  }
  // 存在临时影像金字塔附属文件
  const ovrPath = encodePath + '.ovr';
  if (fs.existsSync(ovrPath))
    fs.unlinkSync(ovrPath);
}


/**
 * 重投影数据集
 */
const project = (ds, epsg, resampling) => {
  let projectDatasetPath = path.join(os.tmpdir(), `${uuid()}.tif`);
  reprojectImage(ds, projectDatasetPath, epsg, resampling);
  return projectDatasetPath;
}


/**
 * 
 * @param {import('gdal').Dataset} dataset
 * @param {number} minZoom
 * 
 * @returns {number} adjustZoom
 */
const buildPyramid = (
  ds,
  minZoom,
  resampling
) => {
  const res = ds.geoTransform[1]; // 使用resx替代整个影像的分辨率
  const maxPixel = Math.min(ds.rasterSize.x, ds.rasterSize.y);
  // 金字塔分级制度，默认2的等比
  let overviewNum = 1;
  while (maxPixel / Math.pow(2, overviewNum) > 256) {
    overviewNum++;
  }
  // 计算originZ
  let res_zoom = (tileBoundTool.xmax - tileBoundTool.xmin) / 256;
  let originZ = 0;
  while (res_zoom / 2 > res) {
    res_zoom = res_zoom / 2;
    originZ++;
  }
  // 即从originZ以下，建立overviewNum个影像金字塔 <originZ| originZ-1 originZ-2 originZ-3 originZ-4 |originZ-5>
  let overviews = [];
  for (let zoom = originZ - 1; zoom >= originZ - 1 - overviewNum; zoom--) {
    if (zoom < minZoom)
      break;
    const factor = Math.pow(2, originZ - zoom)
    overviews.push(factor);

  }
  const buildOverviewResampling = getBuildOverviewResampling(resampling);
  ds.buildOverviews(buildOverviewResampling, overviews);
  // z>=originZ使用原始影像
  return {
    maxOverViewsZ: originZ - 1, // 大于该值用原始影像
    minOverViewsZ: originZ - overviews.length  // 小于该值，用最后一级别影像金字塔索引
  };
}
// 公共资源，包括ds，path对象

let sourceDs, projectDs = null;
// , encodeDs
let projectPath, encodePath = null;
let tileBoundTool;

/**
 * 
 * @param {string} tifFilePath TIF 文件路径
 * @param {string} outputDir 输出目录
 * @param {{
 *   minZoom: number;
 *   maxZoom: number;
 *   epsg: number;
 *   encoding: 'mapbox' | 'terrarium';
 * }} options 可选配置
 */
async function main(input, output, options) {
  // 计时开始
  const startTime = global.performance.now();
  // 结构可选参数
  const { minZoom, maxZoom, epsg, encoding, isClean, resampling } = options;
  // 固定瓦片尺寸
  const tileSize = 256;
  tileBoundTool = tileBoundMap.get(epsg);
  // 判断是否以mbtiles转储
  const isSavaMbtiles = (path.extname(output) === '.mbtiles');
  // 定义切片临时输出目录
  let outputDir = output;
  // 如果以mbtiles存储重定向为临时目录
  if (isSavaMbtiles === true)
    outputDir = path.join(os.tmpdir(), uuid());

  let stepIndex = 0;
  if (isClean === 1) {
    if (isSavaMbtiles === true && fs.existsSync(output))
      fs.unlinkSync(output);
    else
      emptyDir(output);
    console.log(`>> 步骤${++stepIndex}: 清空输出文件夹 - 完成`);
  }
  sourceDs = gdal.open(input, 'r');
  //#region 步骤 1 - 重投影
  if (sourceDs.srs.getAuthorityCode() !== epsg) {
    projectPath = project(sourceDs, epsg, resampling);
    projectDs = gdal.open(projectPath, 'r');
    sourceDs.close(); // 原始的就不需要了
    console.log(`>> 步骤${++stepIndex}: 重投影至 EPSG:${epsg} - 完成`);
  } else {
    projectDs = sourceDs;
  }
  sourceDs = null;
  //#endregion
  //#region 步骤 2 - 建立影像金字塔 由于地形通常是30m 90m精度
  const overViewInfo = buildPyramid(projectDs, minZoom, resampling);
  console.log(`>> 步骤${++stepIndex}: 构建影像金字塔索引 - 完成`);
  //#endregion

  //#region 步骤3 - 切片
  const dsInfo = {
    width: projectDs.rasterSize.x,
    height: projectDs.rasterSize.y,
    resX: projectDs.geoTransform[1],
    resY: projectDs.geoTransform[5],
    startX: projectDs.geoTransform[0],
    startY: projectDs.geoTransform[3],
    endX: projectDs.geoTransform[0] + projectDs.rasterSize.x * projectDs.geoTransform[1],
    endY: projectDs.geoTransform[3] + projectDs.rasterSize.y * projectDs.geoTransform[5],
    path: projectDs.description
  }

  // 计算切片总数
  // 堆积任务数量
  let pileUpCount = 0;
  let miny, maxy;
  if (dsInfo.startY < dsInfo.endY) {
    miny = dsInfo.startY;
    maxy = dsInfo.endY;
  } else {
    miny = dsInfo.endY;
    maxy = dsInfo.startY;
  }
  // xyz是从左上角开始，往右下角走
  let startPoint = [dsInfo.startX, maxy];
  let endPoint = [dsInfo.endX, miny];
  for (let tz = minZoom; tz <= maxZoom; ++tz) {
    const minRC = getTileByCoors(startPoint, tz, tileBoundTool);
    const maxRC = getTileByCoors(endPoint, tz, tileBoundTool);
    statistics.tileCount += (maxRC.row - minRC.row + 1) * (maxRC.column - minRC.column + 1);
    statistics.levelInfo[tz] = {
      tminx: minRC.column,
      tminy: minRC.row,
      tmaxx: maxRC.column,
      tmaxy: maxRC.row,
    };
  }
  // 设置进度条任务总数
  progressBar = new ProgressBar(60, `>> 步骤${++stepIndex}`);
  progressBar.setTaskTotal(statistics.tileCount)
  // 实际裙边有1像素 256+1+1 上下左右各1像素
  // 裙边所需的缩放
  let buffer = 1;
  let outTileSize = tileSize;
  if (encoding === 'mapbox') {
    outTileSize = tileSize + buffer*2;
  }
  for (let tz = minZoom; tz <= maxZoom; tz++) {
    const { tminx, tminy, tmaxx, tmaxy } = statistics.levelInfo[tz];
    let overviewInfo;
    // 根据z获取宽高和分辨率信息
    if (tz > overViewInfo.maxOverViewsZ)
      overviewInfo = dsInfo;
    else {
      let startZ = Math.max(tz, overViewInfo.minOverViewsZ);
      const factorZoom = overViewInfo.maxOverViewsZ - startZ;
      const factor = Math.pow(2, factorZoom+1);
      overviewInfo = {
        index: factorZoom, //影像金字塔序号从0开始
        startX: dsInfo.startX,
        startY: dsInfo.startY,
        width: Math.ceil(dsInfo.width * 1.0 / factor),
        height: Math.ceil(dsInfo.height * 1.0 / factor),
        resX: dsInfo.resX * factor,
        resY: dsInfo.resY * factor
      };
    }
    for (let j = tminx; j <= tmaxx; j++) {
      // 递归创建目录
      mkdirsSync(path.join(outputDir, tz.toString(), j.toString()));
      for (let i = tminy; i <= tmaxy; i++) {
        const tileBound = ST_TileEnvelope(tz, j, i, buffer, tileBoundTool);
        const { rb, wb } = geoQuery(
          overviewInfo,
          tileBound[0],
          tileBound[3],
          tileBound[2],
          tileBound[1],
          outTileSize
        );
        const createInfo = {
          outTileSize,
          overviewInfo,
          rb,
          wb,
          encoding,
          dsPath: dsInfo.path,
          x: j,
          y: i,
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
                  recycle();
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