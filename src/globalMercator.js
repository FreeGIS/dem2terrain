const PI_OVER_360DEG = Math.PI / 360.0;
const PI_OVER_180DEG = Math.PI / 180.0;
const PI_OVER_2 = Math.PI / 2.0;
const PI_MULT_4 = Math.PI * 4;
const PI_MULT_2 = Math.PI * 2;
const PI = Math.PI;
const DEGREES_PER_RADIAN = 180 / Math.PI;

/*
  const globalMercator = new GlobalMercator();
  console.log(globalMercator.TileBounds(224, 117, 8));
*/
class GlobalMercator {
  constructor() {
    this.tileSize = 256;
    this.initialResolution = PI_MULT_2 * 6378137 / this.tileSize;
    this.originShift = PI_MULT_2 * 6378137 / 2.0;
  }

  /**
   * WGS84 经纬度投影至 3857 投影坐标
   * @param {number} lon 经度
   * @param {number} lat 纬度
   * @returns {{
   *   x: number;
   *   y: number;
   * }}
   */
  lonlatToMeters(lon, lat) {
    let x = lon * this.originShift / 180.0;
    let y = Math.log(Math.tan((90 + lat) * PI_OVER_360DEG)) / PI_OVER_180DEG;

    y = y * this.originShift / 180.0;
    return {
      x,
      y
    };
  }

  /**
   * 3857 投影坐标投影至 WGS84 经纬度
   * @param {number} x 经度方向投影坐标 x
   * @param {number} y 纬度方向投影坐标 x
   * @returns {{
   *   lon: number;
   *   lat: number;
   * }}
   */
  metersToLonlat(x, y) {
    const lon = x / this.originShift * 180.0;
    let lat = y / this.originShift * 180.0;
    lat = DEGREES_PER_RADIAN * (2 * Math.atan(Math.exp(lat * PI_OVER_180DEG)) - PI_OVER_2);
    return {
      lon,
      lat,
    };
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
    const pixelX = (x + this.originShift) / res;
    const pixelY = (y + this.originShift) / res;
    return { pixelX, pixelY };
  }

  getResolutionForZoom(zoom) {
    // Resolution (meters/pixel) for given zoom level (measured at Equator)
    return this.initialResolution / Math.pow(2, zoom);
  }

  /**
   * 根据 TMS 瓦片行列号计算在 zoom 缩放等级下的四至
   * @param {number} tileX 瓦片行号
   * @param {number} tileY 瓦片列号
   * @param {number} zoom 缩放等级
   * @param {number} [offset=0] 偏移值 
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
    const mx = pixelX * res - this.originShift;
    const my = pixelY * res - this.originShift;
    //my = this.originShift - py * res;
    //console.log(my, Math.pow(2, zoom) - 1 - my);
    //my = Math.pow(2, zoom) - 1 - my;

    return {
      x: mx,
      y: my
    };
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

  pixelsToRaster(px, py, zoom) {
    // Move the origin of pixel coordinates to top-left corner
    const mapSize = this.tileSize << zoom;
    return {
      x: px,
      y: mapSize - py
    };
  }

  /**
   * 
   * @param {number} lon 
   * @param {number} lat 
   * @param {number} zoom 
   * @returns 
   */
  lonlatToTile(lon, lat, zoom) {
    const {
      x,
      y,
    } = this.lonlatToMeters(lon, lat);
    const {
      pixelX,
      pixelY,
    } = this.metersToPixels(x, y, zoom);
    return this.pixelsToTile(pixelX, pixelY);
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
   * 根据像素大小计算缩放级别
   * @param {number} pixelSize 像素大小
   * @returns {number}
   */
  zoomForPixelSize(pixelSize) {
    for (let i = 0; i < 32; i++) {
      if (pixelSize > this.getResolutionForZoom(i)) {
        if (i !== -1)
          return i - 1;
        else
          return 0;
      }
    }
  }

  /**
   * TMS 瓦片行列号转 Google 瓦片行列号
   * Coordinate origin is moved from bottom-left to top-left corner of the extent
   * @param {number} tmsTileX 
   * @param {number} tmsTileY
   * @param {number} zoom 缩放等级
   * @returns {{
   *   tileX: number;
   *   tileY: number;
   * }}
   */
  googleTile(tmsTileX, tmsTileY, zoom) {
    return {
      tileX: tmsTileX,
      tileY: Math.pow(2, zoom) - 1 - tmsTileY,
    };
  }

  /**
   * Converts TMS tile coordinates to Microsoft QuadTree
   * 
   * @param {number} tileX 
   * @param {number} tileY 
   * @param {number} zoom 
   * @returns {string}
   */
  quadKey(tileX, tileY, zoom) {
    let _key = "";
    tileY = 2 ** zoom - 1 - tileY;
    for (let i = zoom; i > 0; i--) {
      let digit = 0;
      let mask = 1 << (i - 1);
      if ((tileX & mask) !== 0) {
        digit += 1;
      }
      if ((tileY & mask) !== 0) {
        digit += 2;
      }
      _key += digit.toString();
    }
    return _key;
  }

  /**
   * Transform quadkey to tile coordinates
   * @param {string} quadKey 
   * @returns {{
   *   tileX: number;
   *   tileY: number;
   *   zoom: number;
   * }}
   */
  quadKeyToTile(quadKey) {
    let tx = 0;
    let ty = 0;
    let zoom = quadKey.length;
    for (let i = 0; i < zoom; i++) {
      let bit = zoom - i;
      let mask = 1 << (bit - 1);
      if (quadKey[zoom - bit] === "1") {
        tx |= mask;
      }
      if (quadKey[zoom - bit] === "2") {
        ty |= mask;
      }
      if (quadKey[zoom - bit] === "3") {
        tx |= mask;
        ty |= mask;
      }
    }
    ty = 2 ** zoom - 1 - ty;
    return {
      tileX: tx,
      tileY: ty,
      zoom: zoom
    };
  }
}

export default GlobalMercator;

