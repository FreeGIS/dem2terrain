const PI_OVER_360DEG = Math.PI / 360.0;
const PI_OVER_180DEG = Math.PI / 180.0;
const PI_OVER_2 = Math.PI / 2.0;
const PI_MULT_4 = Math.PI * 4;
const PI_MULT_2 = Math.PI * 2;
const PI = Math.PI;
const DEGREES_PER_RADIAN = 180 / Math.PI;
/*
-20026376.39 -20048966.1
20026376.39 20048966.1
*/
/*
73.62 16.7
134.77 53.56
*/
class EPSG3857 {
    constructor(bounds) {
        this.bounds = bounds;
        this.tileSize = 256;

        this.originX = this.bounds[0];
        this.originY = this.bounds[1];
        this.width = this.bounds[2] - this.bounds[0];
        this.height = this.bounds[3] - this.bounds[1];
        this.initialResolution = Math.max(this.width, this.height) / this.tileSize;
    }
    getResolutionForZoom(zoom) {
        // Resolution (meters/pixel) for given zoom level (measured at Equator)
        return this.initialResolution / Math.pow(2, zoom);
    }
    /**
 * 3857 投影坐标转至对应 zoom 等级的瓦片行列号
 * @param {number} x 
 * @param {number} y 
 * @param {number} zoom 
 * @returns {{
 *   tileX: number;
     *   tileY: number;
     * }}
     */
    metersToTile(x, y, zoom) {
        const {
            pixelX,
            pixelY,
        } = this.metersToPixels(x, y, zoom);
        return this.pixelsToTile(pixelX, pixelY);
    }
    /**
* 将 3857 坐标转换至对应缩放等级的像素坐标
* @param {number} x 
* @param {number} y 
* @param {number} zoom 
* @returns {{
*   pixelX: number;
     *   pixelY: number;
     * }}
     */
    metersToPixels(x, y, zoom) {
        // Converts EPSG:900913 to pyramid pixel coordinates in given zoom level
        const res = this.getResolutionForZoom(zoom);
        const pixelX = (x + this.originX) / res;
        const pixelY = (y + this.originY) / res;
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
    pixelsToTile(pixelX, pixelY) {
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
        const xyMin = this.pixelsToMeters(
            tileX * this.tileSize - offset,
            tileY * this.tileSize - offset,
            zoom
        );
        const xyMax = this.pixelsToMeters(
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
     * 计算指定缩放级别下的像素坐标至 3857 投影坐标
     * @param {number} pixelX 像素坐标X
     * @param {number} pixelY 像素坐标Y
     * @param {number} zoom 缩放等级
     * @returns {{
     *   x: number;
     *   y: number;
     * }}
     */
    pixelsToMeters(pixelX, pixelY, zoom) {
        // Converts pixel coordinates in given zoom level of pyramid to EPSG:900913
        const res = this.getResolutionForZoom(zoom);
        const mx = pixelX * res - this.originX;
        const my = pixelY * res - this.originY;

        return {
            x: mx,
            y: my
        };
    }
}