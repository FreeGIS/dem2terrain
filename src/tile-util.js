// 切片范围
let tileBoundMap = new Map();
tileBoundMap.set(3857, {
    xmin: -20037508.342789244,
    ymin: -20037508.342789244,
    xmax: 20037508.342789244,
    ymax: 20037508.342789244
});
tileBoundMap.set(900913, {
    xmin: -20037508.342789244,
    ymin: -20037508.342789244,
    xmax: 20037508.342789244,
    ymax: 20037508.342789244
});
tileBoundMap.set(4490, {
    xmin: -180,
    ymin: -180,
    xmax: 180,
    ymax: 180
});
tileBoundMap.set(4326, {
    xmin: -180,
    ymin: -180,
    xmax: 180,
    ymax: 180
});
// 根据xyz计算对应地理坐标系的地理边界
function ST_TileEnvelope(z, x, y, offset = 0, bbox = tileBoundMap.get(3857)) {
    const boundsWidth = bbox.xmax - bbox.xmin;
    const boundsHeight = bbox.ymax - bbox.ymin;
    if (boundsWidth <= 0 || boundsHeight <= 0)
        throw new Error("Geometric bounds are too small");
    if (z < 0 || z >= 32)
        throw new Error(`Invalid tile zoom value, ${z}`);
    // 总瓦片数量=worldTileSize*worldTileSize
    let worldTileSize = 0x01 << (z > 31 ? 31 : z);

    if (x < 0 || x >= worldTileSize)
        throw new Error(`Invalid tile x value, ${x}`);
    if (y < 0 || y >= worldTileSize)
        throw new Error(`Invalid tile y value, ${y}`);
    // 地理切片分辨率
    const tileGeoSizeX = boundsWidth * 1.0 / worldTileSize;
    const tileGeoSizeY = boundsHeight * 1.0 / worldTileSize;

    let x1 = bbox.xmin + tileGeoSizeX * x - tileGeoSizeX / 256.0 * offset;
    let x2 = bbox.xmin + tileGeoSizeX * (x + 1) + tileGeoSizeX / 256.0 * offset;

    let y1 = bbox.ymax - tileGeoSizeY * (y + 1) - tileGeoSizeY / 256.0 * offset;
    let y2 = bbox.ymax - tileGeoSizeY * (y) + tileGeoSizeY / 256.0 * offset;

    return [x1, y1, x2, y2];

}

// 根据任意地理坐标计算在指定zoom层级下其对应的瓦片行列号
function getTileByCoors(coor, zoom, bbox = tileBoundMap.get(3857)) {
    // 计算coor与bbox左上角坐标
    const left = bbox.xmin;
    const top = bbox.ymax;

    const _width = coor[0] - left;
    const _height = top - coor[1];

    let worldTileSize = 0x01 << zoom;
    const boundsWidth = bbox.xmax - bbox.xmin;
    const boundsHeight = bbox.ymax - bbox.ymin;
    const tileGeoSizeX = boundsWidth * 1.0 / worldTileSize;
    const tileGeoSizeY = boundsHeight * 1.0 / worldTileSize;

    const row = Math.floor(_height / tileGeoSizeY);
    const column = Math.floor(_width / tileGeoSizeX);

    return {
        row, column
    }
}


module.exports = {
    tileBoundMap, ST_TileEnvelope, getTileByCoors
};