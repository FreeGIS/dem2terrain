# dem2terrain
根据dem数据生成地形切片工具，当前仅仅支持Mapboxgl的地形切片格式mapbox和terrarium两种编码格式，主要用于用户自定义地形数据源和本地离线使用。

该工具主要特点如下：
* 支持encoding为mapbox和terrarium两种格式，使用参考[mapbox raster-dem encoding说明](https://docs.mapbox.com/mapbox-gl-js/style-spec/sources/#raster-dem-encoding)。
* 支持自定义瓦片级别和瓦片尺寸设置，瓦片周围会有1像素“裙边”，例如指定512，实际输出514*514瓦片，与mapbox官方一致。
* 自动将输入dem数据源重编码，并重投影至EPSG:3857（web 墨卡托）下生成切片，用户不用管输入数据源，减少操作。
* 内置了影像金字塔索引和多进程实现（未使用多线程），从而加速瓦片生成速度。
* 命令行提供了瓦片生成的进图条提示，便于用户查看生成进度。
![切片生成进度条](https://github.com/FreeGIS/dem2terrain/blob/master/doc/progrebar.png)

注意：该工具统一生成png格式的地形切片，用户通过第三方工具将png转webp时，压缩会导致地形的数据紊乱从而可视化异常。未来应采用gdal webp驱动去支持。

# 一 安装与配置
安装：
```
npm i dem2terrain -g
```

配置：
由于使用的是gdal，用户需要[下载gdal-data](https://github.com/FreeGIS/dem2terrain/blob/master/gdal-data.zip)，以windows为例，解压gdal-data到本地后，在本机环境变量定义gdal-data以免运行环境不支持。
![配置环境变量](https://github.com/FreeGIS/dem2terrain/blob/master/doc/gdal-data.png)


# 二 使用

```
dem2terrain --help

Usage: dem2terrain [options] <dem file path> <output directory path>

dem文件转mapbox地形切片工具

Arguments:
  dem file path               输入tiff格式的dem文件路径
  output directory path       输出地形切片文件路径

Options:
  -v,--vers                   当前版本号
  -z, --zoom <number-number>  切片级别 (default: "5-14")
  -s, --size <number>         切片尺寸（256或512） (default: "512")
  -e, --encoding <string>     地形编码规则（terrarium或mapbox） (default: "mapbox")
  -h, --help                  display help for command
```

可选参数说明：

* -z:指定生成地形的zoom级别，start-end整型格式，默认5-14级别，由于地形通常是90m、30m分辨率，切片zoom太大也没什么意义不能提升精度了，而zoom太小，基本也不会显示地形，所以默认生成中间的5-14级别。
* -s:指定tile尺寸，默认是512。
* -e:指定切片编码规则，默认mapbox，用户可指定terrarium规则输出。

# 三 项目使用

将该工具生成切片文件夹通过web服务器发布，根据[mapboxgl地形examples]简单修改，将在线数据源换成本地web服务器发布的地址即可，注意是否声明raster-dem的encoding格式，这取决于你生成的切片编码，保持一致即可。

![本地离线切片可视化](https://github.com/FreeGIS/dem2terrain/blob/master/doc/terrain.png)

# 四 todo
当前版本足够mapbox使用，但仍然有新功能未开发，留待以后扩展功能，初步拟定待扩展功能如下：

* 扩展node-gdal驱动，使其支持webp，直接生成webp格式的切片。
* 重构核心模块并解耦，然后扩展使其支持生成cesium的terrier格式地形切片。
* 升级支持生成mbtiles文件。


# 五 知识补充

mapbox和terrarium都将dem的高度编码成rgb存储，两种差异如下：

mapbox的地形编码和解码：
```
function mapboxEncode(height) {
    const value = Math.floor((height + 10000) * 10);
    const r = value >> 16;
    const g = value >> 8 & 0x0000FF;
    const b = value & 0x0000FF;
    return [r, g, b];
}
function mapboxDecode(color) {
    return -10000 + ((color[0] * 256 * 256 + color[1] * 256 + color[2]) * 0.1);
}

```

terrarium 的地形编码和解码：
```
function terrariumEncode(height) {
    height += 32768;
    const r = Math.floor(height / 256.0);
    const g = Math.floor(height % 256);
    const b = Math.floor((height - Math.floor(height)) * 256.0);
    return [r, g, b];
}

function terrariumDecode(color) {
    return (color[0] * 256 + color[1] + color[2] / 256.0) - 32768;
}
```