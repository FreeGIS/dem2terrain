# dem2mapboxterrain
根据dem数据生成Mapboxgl可用的地形切片工具，特点如下：
* 支持encoding为mapbox和terrarium两种格式。
* 支持自定义瓦片级别和瓦片尺寸设置，瓦片周围会有1像素“裙边”，例如指定512，实际输出514*514瓦片，与mapbox官方一致。
* 自动将输入dem数据源重编码，并重投影至EPSG:3857（web 墨卡托）下生成切片，用户不用管输入数据源，减少操作。
* 内置了影像金字塔索引和多子进程实现，加速瓦片生成速度。
* 命令行提供了瓦片生成的进图条提示，便于用户查看生成进度。

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