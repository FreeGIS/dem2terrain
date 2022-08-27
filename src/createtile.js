import { join } from 'path';
import gdal from 'gdal';
import { createDirs } from './util.js';
import { getDriverByName } from './gdal-util.js';

const {
  GDT_Byte,
  open,
} = gdal

function write_terrain_tile(overviewInfo, readinfo, writeinfo, bandnums) {
  bandnums.forEach(i => {
    let readband;
    if (overviewInfo.index === undefined)
      readband = readinfo.ds.bands.get(i);
    else // 从影像金字塔里读取band信息
      readband = readinfo.ds.bands.get(i).overviews.get(overviewInfo.index);
    let writeband = writeinfo.ds.bands.get(i);
    let bandBuffData = new Uint8Array(writeinfo.wxsize * writeinfo.wysize);
    // 从数据集band读取对应的像素出来写入bandBuffData
    readband.pixels.read(readinfo.rx, readinfo.ry, readinfo.rxsize, readinfo.rysize, bandBuffData, {
      buffer_width: writeinfo.wxsize,
      buffer_height: writeinfo.wysize,
      data_type: GDT_Byte
    });
    // 写入
    writeband.pixels.write(writeinfo.wx, writeinfo.wy, writeinfo.wxsize, writeinfo.wysize, bandBuffData);
  })
}

let dataset = null;
let memDriver = null;

export function createTile(createInfo, callback) {
  const {
    outTileSize,
    overviewInfo,
    rb,
    wb,
    dsPath,
    x,
    y,
    z,
    outputTile,
  } = createInfo;
  if (dataset === null) {
    dataset = open(dsPath, 'r');
  }
  // 创建一个 mem 驱动，将读取的像素暂存至内存
  if (memDriver === null) {
    memDriver = getDriverByName('mem');
  }
  const msmDS = memDriver.create("", outTileSize, outTileSize, 3);
  rb.ds = dataset;
  wb.ds = msmDS;
  write_terrain_tile(overviewInfo, rb, wb, [1, 2, 3]);
  const pngPath = join(outputTile, '/' + z + '/' + x + '/' + y + '.png');
  //递归创建文件目录
  createDirs(pngPath);
  const pngDriver = getDriverByName('png');
  const pngDs = pngDriver.createCopy(pngPath, msmDS);

  // 释放内存
  msmDS.flush();
  msmDS.close();
  pngDs.close();
  callback(null, process.pid);
}

export function closeDataset(callback) {
  if (dataset) {
    dataset.close();
    dataset = null;
    callback(null, process.pid);
  }
  callback(null, null);
}
