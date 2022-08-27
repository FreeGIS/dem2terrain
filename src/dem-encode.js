/**
 * MapboxGL raster-dem 编码
 * @param {number} height 高程值
 * @returns {[number, number, number]}
 */
function mapboxEncode(height) {
    const value = Math.floor((height + 10000) * 10);
    const r = value >> 16;
    const g = value >> 8 & 0x0000FF;
    const b = value & 0x0000FF;
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
 * @returns {[number, number, number]}
 */
function terrariumEncode(height) {
    height += 32768;
    const r = Math.floor(height / 256.0);
    const g = Math.floor(height % 256);
    const b = Math.floor((height - Math.floor(height)) * 256.0);
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

module.exports = {
    mapboxEncode, terrariumEncode, mapboxDecode, terrariumDecode
}