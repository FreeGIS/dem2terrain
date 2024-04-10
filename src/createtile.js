const gdal = require('gdal-async');
const { getDriverByName } = require('./gdal-util');
const path = require('path');
const fs = require('fs');
const { createCanvas, Image } = require('@napi-rs/canvas');
const canvas = createCanvas(1, 1);

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
}

let dataset = null, memDriver = null, pngDriver = null;
function createTile(createInfo, callback) {
    const { outTileSize, overviewInfo, rb, wb, dsPath, x, y, z, outputTile } = createInfo;
    if (dataset === null)
        dataset = gdal.open(dsPath, 'r');
    // 创建一个mem内存，将读取的像素写入mem
    if (memDriver === null)
        memDriver = getDriverByName('mem');
    const msmDS = memDriver.create("", outTileSize, outTileSize, 3);
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
    transparentTile(pngPath, outTileSize);
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

//需要忽略的颜色值
const ignoreColors = [
    [0, 0, 0]
];

function isIgnoreColor(r, g, b) {
    for (let i = 0, len = ignoreColors.length; i < len; i++) {
        const color = ignoreColors[i];
        const [cr, cg, cb] = color;
        if (cr === r && cg === g && cb === b) {
            return true;
        }
    }
    return false;
}

//透明瓦片
function transparentTile(tilePath, outTileSize) {
    if (!fs.existsSync(tilePath)) {
        return;
    }
    const width = outTileSize, height = outTileSize;
    const buffer = fs.readFileSync(tilePath);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    const img = new Image();
    img.src = buffer;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    for (let i = 0, len = imageData.data.length; i < len; i += 4) {
        const r = imageData.data[i];
        const g = imageData.data[i + 1];
        const b = imageData.data[i + 2];
        if (isIgnoreColor(r, g, b)) {
            imageData.data[i + 3] = 0;
        }
    }
    ctx.putImageData(imageData, 0, 0);
    const newBuffer = canvas.toBuffer('image/png');
    fs.writeFileSync(tilePath, newBuffer);
}
module.exports = { createTile, closeDataset }