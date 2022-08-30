/**
 * MapboxGL raster-dem 编码
 * @param {number} height 高程值
 * @param {array} out 输出值,用来存放输出结果
 * @returns {[number, number, number]}
 */
function mapboxEncode(height, out) {
    const value = Math.floor((height + 10000) * 10);
    const r = value >> 16;
    const g = value >> 8 & 0x0000FF;
    const b = value & 0x0000FF;
    if (out) {
        out[0] = r;
        out[1] = g;
        out[2] = b;
        return out;
    }
    return [r, g, b];
}

/**
 * MapboxGL raster-dem 解码
 * @param {[number, number, number]} color 
 * @returns {number} 高程值
 */
function mapboxDecode(color) {
    return -10000 + ((color[0] * 256 * 256 + color[1] * 256 + color[2]) * 0.1);
}


/**
 * Terrarium 编码
 * @param {number} height 高程值
 * @param {array} out 输出值,用来存放输出结果
 * @returns {[number, number, number]}
 */
function terrariumEncode(height, out) {
    height += 32768;
    const r = Math.floor(height / 256.0);
    const g = Math.floor(height % 256);
    const b = Math.floor((height - Math.floor(height)) * 256.0);
    if (out) {
        out[0] = r;
        out[1] = g;
        out[2] = b;
        return out;
    }
    return [r, g, b];
}

/**
 * Terrarium 解码
 * @param {[number, number, number]} color 
 * @returns {number} 高程值
 */
function terrariumDecode(color) {
    return (color[0] * 256 + color[1] + color[2] / 256.0) - 32768;
}


/**
 * Cesium 编码
 * @param {number} height 高程值
 * @returns {number} 编码值，Int16
 */
function cesiumEncode(height) {
    return Math.floor((height + 1000) / 0.2);
}
/**
* Cesium 解码
* @param {number} pixel 编码值，Int16
* @returns {number} 高程值
*/
function cesiumDecode(pixel) {
    return (pixel * 0.2) - 1000;
}


const mapboxDem = {
    encode: mapboxEncode,
    tileSchema: 'xyz',
    tileSize: 512,
    extension: 'png'
}
const terrariumDem = {
    encode: terrariumEncode,
    tileSchema: 'xyz',
    tileSize: 512,
    extension: 'png'
}
const cesiumDem = {
    encode: cesiumEncode,
    tileSchema: 'tms',
    tileSize: 65,
    extension: 'terrain'
}
module.exports = {
    mapboxDem, terrariumDem, cesiumDem
}