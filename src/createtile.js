const gdal = require('gdal-async');
const { getDriverByName } = require('./gdal-util');
const { mapboxEncode, terrariumEncode } = require('./dem-encode');
const path = require('path');
const fs = require('fs');

let dataset = null, noData = null, memDriver = null, pngDriver = null;
const invalidColor = [1, 134, 160];// 编码后凑海拔=0，修复地形塌陷产生空白
let outTileSize1;
function forEachHeightBuffer(heightBuffer, encode) {
    const channelLength = heightBuffer.length;
    const rBuffer = new Uint8Array(channelLength);
    const gBuffer = new Uint8Array(channelLength);
    const bBuffer = new Uint8Array(channelLength);
    const aBuffer = new Uint8Array(channelLength);
    for (let i = 0; i < channelLength; i++) {
        let heightVal = heightBuffer[i];
        let color;
        if (heightVal === noData)
            color = invalidColor; // 编码后凑海拔=0，修复地形塌陷产生空白
        else
            color = encode(heightVal);
        rBuffer[i] = color[0];
        gBuffer[i] = color[1];
        bBuffer[i] = color[2];
        aBuffer[i] = 255;
    }
    return [rBuffer, gBuffer, bBuffer, aBuffer];
}


function writeTerrainTile(overviewInfo, readinfo, writeinfo, encoding) {
    let readband;
    if (overviewInfo.index === undefined)
        readband = readinfo.ds.bands.get(1);
    else // 从影像金字塔里读取band信息
        readband = readinfo.ds.bands.get(1).overviews.get(overviewInfo.index);
    let dataType = readband.dataType;
    let heightBuffer;
    // 特殊异常处理
    if  (dataType == gdal.GDT_Byte) 
        heightBuffer = new Uint8Array(writeinfo.wxsize * writeinfo.wysize);
    else if (dataType === gdal.GDT_Int16)
        heightBuffer = new Int16Array(writeinfo.wxsize * writeinfo.wysize);
    else if (dataType === gdal.GDT_Float32)
        heightBuffer = new Float32Array(writeinfo.wxsize * writeinfo.wysize);
    else if (dataType === 'Int8') {
        heightBuffer = new Int16Array(writeinfo.wxsize * writeinfo.wysize);
        dataType = gdal.Int16Array;
    }

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

    let _length = outTileSize1 * outTileSize1;
    let r = new Uint8Array(_length);
    let g = new Uint8Array(_length);
    let b = new Uint8Array(_length);
    let a = new Uint8Array(_length);
    for (let i = 0; i < _length; i++) {
        r[i] = invalidColor[0];
        g[i] = invalidColor[1];
        b[i] = invalidColor[2];
        a[i] = 255;
    };
    let defaultBuffers = [r, g, b, a];
    [1, 2, 3, 4].forEach(index => {
        let writeband = writeinfo.ds.bands.get(index);
        // 先填充默认值
        writeband.pixels.write(0, 0, outTileSize1, outTileSize1, defaultBuffers[index - 1]);
        // 填充实际值
        writeband.pixels.write(writeinfo.wx, writeinfo.wy, writeinfo.wxsize, writeinfo.wysize, encodeBuffers[index - 1]);
    });
}


function createTile(createInfo, callback) {
    const { outTileSize, overviewInfo, rb, wb, encoding, dsPath, x, y, z, outputTile } = createInfo;
    outTileSize1 = outTileSize;
    if (dataset === null) {
        dataset = gdal.open(dsPath, 'r');
        // 查询no_data数值
        noData = dataset.bands.get(1).noDataValue;
    }
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