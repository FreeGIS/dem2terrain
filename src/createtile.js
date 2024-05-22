const gdal = require('gdal-async');
const { getDriverByName } = require('./gdal-util');
const { mapboxEncode, terrariumEncode } = require('./dem-encode');
const path = require('path');
const fs = require('fs');

let dataset = null, memDriver = null, pngDriver = null;
function forEachHeightBuffer(heightBuffer, encode) {
    const channelLength = heightBuffer.length;
    const rBuffer = new Uint8Array(channelLength);
    const gBuffer = new Uint8Array(channelLength);
    const bBuffer = new Uint8Array(channelLength);

    for (let i = 0; i < channelLength; i++) {
        const color = encode(heightBuffer[i]);
        rBuffer[i] = color[0];
        gBuffer[i] = color[1];
        bBuffer[i] = color[2];
    }
    return [rBuffer, gBuffer, bBuffer];
}


function writeTerrainTile(overviewInfo, readinfo, writeinfo, encoding) {
    let readband;
    if (overviewInfo.index === undefined)
        readband = readinfo.ds.bands.get(1);
    else // 从影像金字塔里读取band信息
        readband = readinfo.ds.bands.get(1).overviews.get(overviewInfo.index);
    //let writeband = writeinfo.ds.bands.get(i);
    let dataType = readband.dataType;
    let heightBuffer;
    if (dataType === gdal.GDT_Int16)
        heightBuffer = new Int16Array(writeinfo.wxsize * writeinfo.wysize);
    else if (dataType === gdal.GDT_Float32)
        heightBuffer = new Float32Array(writeinfo.wxsize * writeinfo.wysize);

    readband.pixels.read(readinfo.rx, readinfo.ry, readinfo.rxsize, readinfo.rysize, heightBuffer, {
        buffer_width: writeinfo.wxsize,
        buffer_height: writeinfo.wysize,
        data_type: dataType
    });
    // heightBuffer转码rgb编码
    let encodeBuffers;
    // 循环高程，转rgb编码
    if (encoding === 'mapbox') {
        encodeBuffers = forEachHeightBuffer(heightBuffer, mapboxEncode);
    } else if (encoding === 'terrarium') {
        encodeBuffers = forEachHeightBuffer(heightBuffer, terrariumEncode);
    }
    [1, 2, 3].forEach(index => {
        let writeband = writeinfo.ds.bands.get(index);
        writeband.pixels.write(writeinfo.wx, writeinfo.wy, writeinfo.wxsize, writeinfo.wysize, encodeBuffers[index - 1]);
    });

    // 写入mask band
    let mask_buffer = (new Uint8Array(writeinfo.wxsize * writeinfo.wysize)).fill(255);
    let mask_band = writeinfo.ds.bands.get(4);
    mask_band.pixels.write(writeinfo.wx, writeinfo.wy, writeinfo.wxsize, writeinfo.wysize, mask_buffer);
}


function createTile(createInfo, callback) {
    const { outTileSize, overviewInfo, rb, wb, encoding, dsPath, x, y, z, outputTile } = createInfo;
    if (dataset === null)
        dataset = gdal.open(dsPath, 'r');
    // 创建一个mem内存，将读取的像素写入mem
    if (memDriver === null)
        memDriver = getDriverByName('mem');
    const msmDS = memDriver.create("", outTileSize, outTileSize, 4);
    rb.ds = dataset;
    wb.ds = msmDS;
    writeTerrainTile(overviewInfo, rb, wb, encoding);
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