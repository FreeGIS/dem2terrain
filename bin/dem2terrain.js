#!/usr/bin/env node
const program = require('commander');
const main = require('../index');
const path = require('path');
const version = '1.0.4';

program.name('dem2terrain')
  .description('使用 GDAL 制作地形瓦片，支持 mapbox 和 terrarium 两种编码输出格式，当前仅输出 PNG 容器格式。')
  .argument('<input-tiff-file>', '输入 tif 格式的 DEM 文件路径，支持相对路径')
  .argument('<output-directory>', '输出目录，支持相对路径')
  .version(version, '-v, --version', '当前版本')
  .helpOption('-h, --help', '帮助');

// --- 配置可选参数
program
  .option('-c, --epsg <number>', '3857 或 4490| 默认 3857', '3857')
  .option('-s, --size <number>', '指定生成瓦片的尺寸（256 或 512）| 默认 512 像素', '512')
  .option('-z, --zoom <number-number>', '指定瓦片的等级生成范围。例如，想生成 7 ~ 12 级的瓦片，则输入 -z 7-12 | 默认值是 -z 5-14', '5-14')
  .option('-e, --encoding <string>', '指定瓦片的数据编码规则（mapbox 或 terrarium）| 默认 -e mapbox', 'mapbox');

// --- 解析参数
program.parse();

// --- 必选参数
const args = program.args
if (args.length !== 2) {
  console.log('参数缺失: 输入文件路径或输出目录必填');
  process.exit();
}
const inputDem = args[0];
const outputDir = args[1];

// --- 可选参数
const options = program.opts();

const tileSize = Number(options['size']);
const encoding = options['encoding'];
const epsg = Number(options['epsg']);
let zoom = options['zoom'];
zoom = zoom.split('-');
const minZoom = Number(zoom[0]);
const maxZoom = Number(zoom[1]);
if (isNaN(minZoom) || isNaN(maxZoom)) {
  console.log(`参数 -zoom: ${zoom} 错误，应为整数`);
  process.exit();
}
if (minZoom >= maxZoom) {
  console.log(`参数 -zoom: ${zoom} 错误：最小级别: ${minZoom} 应小于最大级别: ${maxZoom}`);
  process.exit();
}

const inputAbsolutePath = path.isAbsolute(inputDem) ? inputDem : path.resolve(process.cwd(), inputDem);
const outFileAbsolutePath = path.isAbsolute(outputDir) ? outputDir : path.resolve(process.cwd(), outputDir);

const logMsg = `\n>> 开始转换...
- 输入文件: ${inputAbsolutePath}
- 输出路径: ${outFileAbsolutePath}
- 瓦片编码: ${encoding === 'mapbox' ? 'mapbox(raster-dem)' : encoding}
- 瓦片尺寸: ${tileSize} px
- 瓦片等级: ${minZoom} 至 ${maxZoom} 级
`;
console.log(logMsg);

main(inputDem, outputDir, {
  minZoom,
  maxZoom,
  epsg,
  tileSize,
  encoding
});