const gdal = require('gdal-async');
const { getDriverByName } = require('./gdal-util');
const path = require('path');
const fs = require('fs');

function writeTerrainTile(overviewInfo, readinfo, writeinfo, bandnums) {
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
            data_type: gdal.GDT_Byte
        });
        // 写入
        writeband.pixels.write(writeinfo.wx, writeinfo.wy, writeinfo.wxsize, writeinfo.wysize, bandBuffData);
    })
    // 写入mask band
    let mask_buffer  = (new Uint8Array(writeinfo.wxsize * writeinfo.wysize)).fill(255);
    let mask_band = writeinfo.ds.bands.get(4);
    mask_band.pixels.write(writeinfo.wx, writeinfo.wy, writeinfo.wxsize, writeinfo.wysize, mask_buffer);
}

let dataset = null, memDriver = null, pngDriver = null;
function createTile(createInfo, callback) {
    const { outTileSize, overviewInfo, rb, wb, dsPath, x, y, z, outputTile } = createInfo;
    if (dataset === null)
        dataset = gdal.open(dsPath, 'r');
    // 创建一个mem内存，将读取的像素写入mem
    if (memDriver === null)
        memDriver = getDriverByName('mem');
    const msmDS = memDriver.create("", outTileSize, outTileSize, 4);
    rb.ds = dataset;
    wb.ds = msmDS;
    writeTerrainTile(overviewInfo, rb, wb, [1, 2, 3]);
    const pngPath = path.join(outputTile, z.toString(), x.toString(), y + '.png');
    if (pngDriver === null)
        pngDriver = getDriverByName('png');
    let pngDs = pngDriver.createCopy(pngPath, msmDS);


    // 释放内存
    msmDS.flush();
    msmDS.close();
    pngDs.close();
    callback(null, process.pid);
}
function closeDataset(callback) {
    if (dataset) {
        dataset.close();
        dataset = null;
        callback(null, process.pid);
    }
    callback(null, null);

}
module.exports = { createTile, closeDataset }