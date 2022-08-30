const dem = require('../src/dem-encode');
const channelLength = 100000000;
const heights = new Int16Array(channelLength);
for (let i = 0, len = channelLength; i < len; i++) {
    heights[i] = Math.round(Math.random() * 10000);
}

const rChannelBuffer = new Uint8Array(channelLength);
const gChannelBuffer = new Uint8Array(channelLength);
const bChannelBuffer = new Uint8Array(channelLength);
const time = '编码优化前';
console.time(time);
heights.forEach((height, i) => {
    const color = dem.mapboxDem.encode(height);
    rChannelBuffer[i] = color[0];
    gChannelBuffer[i] = color[1];
    bChannelBuffer[i] = color[2];
});
console.timeEnd(time);

const TEMPCOLOR = [1, 1, 1];
const time1 = '编码优化后';
console.time(time1);
for (let i = 0, len = channelLength; i < len; i++) {
    const height = heights[i];
    const color = dem.mapboxDem.encode(height, TEMPCOLOR);
    rChannelBuffer[i] = color[0];
    gChannelBuffer[i] = color[1];
    bChannelBuffer[i] = color[2];
}
console.timeEnd(time1);