#!/usr/bin/env node
const program = require('commander');
const main = require('../index');
const path = require('path');
const version = require('../package.json').version;

// node版本检查
if(+process.version.substring(1,3)<16){
  console.error(`node版本>=16，当前版本 ${process.version}`);
  process.exit();
}
// { version } from 'node:process';
program.name('dem2terrain')
  .description('使用 GDAL 制作地形瓦片，支持 mapbox 和 terrarium 两种编码输出格式，当前仅输出 PNG 容器格式。')
  .version(version, '-v, --version', '当前版本')
  .helpOption('-h, --help', '帮助');

// --- 配置可选参数
program
  .option('-i, --input <string>', '<必填> 输入 tif 格式的 DEM 文件路径，支持相对路径')
  .option('-o, --output <string>', '<必填> 输出目录，支持相对路径')
  .option('-f, --configFile <File>', '<可选> 通过配置文件执行任务，输入绝对路径，可参考配置模板')
  .option('-r, --resampling <number>', `<可选> 构建影像金字塔或重投影时设置重采样策略，默认3，1:AVERAGE|
  2:BILINEAR|3:CUBIC|
  4:CUBICSPLINE|5:LANCZOS|
  6:MODE|7:NEAREST`, 3)
  .option('-g, --epsg <number>', '<可选> Tile适用坐标系，3857 | 4490 | 4326', 3857)
  .option('-c, --clean <number>', '<可选> 是否清空输出目录，0 | 1', 0)
  .option('-z, --zoom <number-number>', '<可选> 指定瓦片的等级生成范围。例如，想生成 7 ~ 12 级的瓦片，则输入 -z 7-12', '5-14')
  .option('-e, --encoding <string>', '<可选> 指定瓦片的数据编码规则（mapbox 或 terrarium）', 'mapbox');

// --- 解析参数
program.parse();

const options = program.opts();
// 判别是否是配置文件还是命令行配置
let params;
if (options['configFile']) 
  params = require(options['configFile']);
else 
  params = options;
const inputDem = params['input'];
const outputDir = params['output'];
if(inputDem===undefined||outputDir===undefined){
  console.log('参数缺失: 输入文件路径或输出目录必填');
  process.exit();
}

const encoding = params['encoding'];
const epsg = Number(params['epsg']);
const isClean = Number(params['clean']);
let zoom = params['zoom'];
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
- Tile适用坐标系: EPSG:${epsg}
- 瓦片编码: ${encoding === 'mapbox' ? 'mapbox(raster-dem)' : encoding}
- 瓦片尺寸: 256 px
- 瓦片等级: ${minZoom} 至 ${maxZoom} 级
`;
console.log(logMsg);

main(inputDem, outputDir, {
  minZoom,
  maxZoom,
  epsg,
  encoding,
  isClean
});