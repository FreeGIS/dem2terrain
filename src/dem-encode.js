// mapbox格式的地形编码和解码
function mapboxEncode(height) {
    const value = Math.floor((height + 10000) * 10);
    const r = value >> 16;
    const g = value >> 8 & 0x0000FF;
    const b = value & 0x0000FF;
    return [r, g, b];
}

// 暂时未使用
function mapboxDecode(color) {
    return -10000 + ((color[0] * 256 * 256 + color[1] * 256 + color[2]) * 0.1);
}

// Terrarium格式的地形编码和解码
function terrariumEncode(height) {
    height += 32768;
    const r = Math.floor(height / 256.0);
    const g = Math.floor(height % 256);
    const b = Math.floor((height - Math.floor(height)) * 256.0);
    return [r, g, b];
}
// 暂时未使用
function terrariumDecode(color) {
    return (color[0] * 256 + color[1] + color[2] / 256.0) - 32768;
}

module.exports ={
    mapboxEncode,terrariumEncode
}