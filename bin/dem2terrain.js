#!/usr/bin/env node
const program = require('commander');
const main = require('../src/main');
program
  .name('dem2terrain')
  .description('dem文件转mapbox地形切片工具')
  .argument('<input dem file path>', '输入tiff格式的dem文件路径')
  .argument('<output tile directory path>', '输出地形切片文件路径')
  .version('1.0.0', '-v,--vers', '当前版本号');

// 定义可选条件
program.option('-z, --zoom <number-number>', '切片级别', '5-14');
program.option('-s, --size <number>', '切片尺寸（256或512）', '512');
program.option('-e, --encoding <string>', '地形编码规则（terrarium或mapbox）', 'mapbox');

// 解析参数
program.parse();

if (program.args.length !== 2) {
  console.log('dem输入文件路径和Tile输出目录必填！');
  process.exit();
}
const inputDem = program.args[0];
const outputTile = program.args[1];

// 处理可选参数
const options = program.opts();

const tileSize = Number(options['size']);
const encoding = options['encoding']
let zoom = options['zoom'];
zoom = zoom.split('-');
const minZoom = Number(zoom[0]);
const maxZoom = Number(zoom[1]);
if (isNaN(minZoom) || isNaN(maxZoom)) {
  console.log('切片输入设置不正确！');
  process.exit();
}
if (minZoom >= maxZoom) {
  console.log('切片最小zoom设置应小于最大zoom！');
  process.exit();
}

main(inputDem, outputTile, {
  minZoom, maxZoom, tileSize, encoding
});