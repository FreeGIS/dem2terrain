let boundMap = new Map();
boundMap.set(3857,[-20026376.39,-20048966.1,20026376.39,20048966.1]);
boundMap.set(900913,[-20026376.39,-20048966.1,20026376.39,20048966.1]);
boundMap.set(4490,[-180,-90,180,90]);
boundMap.set(4326,[-180,-90,180,90]);

class CoordinateSys {
    constructor(epsg) {
        const bounds = boundMap.get(epsg);
        this.tileSize = 256;
        this.originX = bounds[0];
        this.originY = bounds[1];
        this.width = bounds[2] - bounds[0];
        this.height = bounds[3] - bounds[1];
        this.initialResolution = Math.min(this.width, this.height) / this.tileSize;
    }
    getResolutionByZoom(zoom) {
        return this.initialResolution / Math.pow(2, zoom);
    }
    /**
    * 坐标转至对应 zoom 等级的瓦片行列号
    * @param {number} x 
    * @param {number} y 
    * @param {number} zoom 
    * @returns {{
    *   tileX: number;
    *   tileY: number;
    * }}
    */
    point2Tile(x, y, zoom) {
        const {
            pixelX,
            pixelY,
        } = this.point2Pixel(x, y, zoom);
        return this.pixel2Tile(pixelX, pixelY);
    }
    /**
    * 将坐标转换至对应缩放等级的像素坐标
    * @param {number} x 
    * @param {number} y 
    * @param {number} zoom 
    * @returns {{
    *   pixelX: number;
    *   pixelY: number;
    * }}
    */
    point2Pixel(x, y, zoom) {
        const res = this.getResolutionByZoom(zoom);
        const pixelX = (x - this.originX) / res;
        const pixelY = (y - this.originY) / res;
        return { pixelX, pixelY };
    }
    /**
    * 像素坐标至瓦片行列号
    * @param {number} pixelX 像素坐标
    * @param {number} pixelY 像素坐标
    * @returns {{
    *   tileX: number;
    *   tileY: number;
    * }}
    */
    pixel2Tile(pixelX, pixelY) {
        const tileX = Math.floor(Math.ceil(pixelX * 1.0 / this.tileSize) - 1);
        const tileY = Math.floor(Math.ceil(pixelY * 1.0 / this.tileSize) - 1);
        return {
            tileX,
            tileY,
        };
    }
    /**
    * 根据 TMS 瓦片行列号计算在 zoom 缩放等级下的四至
    * @param {number} tileX 瓦片行号
    * @param {number} tileY 瓦片列号
    * @param {number} zoom 缩放等级
    * @param {number} [offset=0] 偏移像素值 
    * @returns {{
    *   xMin: number;
    *   yMin: number;
    *   xMax: number;
    *   yMax: number;
    * }}
    */
    tileBounds(tileX, tileY, zoom, offset = 0) {
        const xyMin = this.pixel2Point(
            tileX * this.tileSize - offset,
            tileY * this.tileSize - offset,
            zoom
        );
        const xyMax = this.pixel2Point(
            (tileX + 1) * this.tileSize + offset,
            (tileY + 1) * this.tileSize + offset,
            zoom
        );

        return {
            xMin: xyMin.x,
            yMin: xyMin.y,
            xMax: xyMax.x,
            yMax: xyMax.y
        };
    }

    /**
     * 计算指定缩放级别下的像素坐标至地理坐标
     * @param {number} pixelX 像素坐标X
     * @param {number} pixelY 像素坐标Y
     * @param {number} zoom 缩放等级
     * @returns {{
     *   x: number;
     *   y: number;
     * }}
     */
    pixel2Point(pixelX, pixelY, zoom) {
        const res = this.getResolutionByZoom(zoom);
        const mx = pixelX * res + this.originX;
        const my = pixelY * res + this.originY;
        return {
            x: mx,
            y: my
        };
    }
}

module.exports = CoordinateSys;