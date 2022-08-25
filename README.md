# dem2mapboxterrain
根据dem数据生成Mapboxgl可用的地形切片工具，mapboxgl支持encoding为mapbox和terrarium两种格式，该工具都支持。

# 一 安装
```
npm i dem2mapboxterrain -g
```

# 二 使用

```
dem2mt --help

Usage: mapbox-terrain-dem [options] <dem file path> <output directory path>

dem文件转mapbox地形切片工具

Arguments:
  dem file path               输入tiff格式的dem文件路径
  output directory path       输出地形切片文件路径

Options:
  -v,--vers                   当前版本号
  -z, --zoom <number-number>  切片级别 (default: "5-15")
  -s, --size <number>         切片尺寸（256或512） (default: "512")
  -e, --encoding <string>     地形编码规则（terrarium或mapbox） (default: "mapbox")
  -h, --help                  display help for command
```

可选参数说明：

* -z:指定生成地形的zoom级别，start-end整型格式。
* -s:指定tile尺寸，默认是512。
* -e:指定切片编码规则，默认mapbox，用户可指定terrarium规则输出。