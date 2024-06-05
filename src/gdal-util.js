const gdal = require('gdal-async');
// 根据策略获取对应的采样方法
function getBuildOverviewResampling(resampling) {
  switch (resampling) {
    case 1:
      return "AVERAGE";
    case 2:
      return "BILINEAR";
    case 3:
      return "CUBIC";
    case 4:
      return "CUBICSPLINE";
    case 5:
      return "LANCZOS";
    case 6:
      return "MODE";
    case 7:
      return "NEAREST";
    default:
      return "CUBIC";
  }
}

function getResampling(resampling) {
  switch (resampling) {
    case 1:
      return gdal_resampling = gdal.GRA_Average;
    case 2:
      return gdal_resampling = gdal.GRA_Bilinear;
    case 3:
      return gdal_resampling = gdal.GRA_Cubic;
    case 4:
      return gdal_resampling = gdal.GRA_CubicSpline;
    case 5:
      return gdal_resampling = gdal.GRA_Lanczos;
    case 6:
      return gdal_resampling = gdal.GRA_Mode;
    case 7:
      return gdal_resampling = gdal.GRA_NearestNeighbor;
    default:
      return gdal_resampling = gdal.GRA_Cubic;
  }
}


/**
 * 根据驱动名称（支持任意大小写）获取 GDAL 驱动
 * @param {string} driverName 驱动名称
 * @returns {import('gdal').Driver}
 */
function getDriverByName(driverName) {
  const length = gdal.drivers.count();
  let nameNormal = driverName.toUpperCase();
  for (let i = 0; i < length; i++) {
    const driver = gdal.drivers.get(i);
    if (driver.description === nameNormal) { return driver; }
  }
  throw new Error(`当前gdal中不存在输入的驱动名称${nameNormal}`);
}
/**
 * @function 栅格重投影
 * @description 输入一个源数据，设置投影输出数据文件路径和投影坐标系的epsg编码，设置采样参数，输出栅格重投影文件
 * @param {string | import('gdal').Dataset} src_ds  输入的栅格文件路径或者gdal的数据集对象。
 * @param {string} reproject_path  输出的重投影后的栅格文件路径。
 * @param {number} t_epsg  重投影的坐标系epsg编码。
 * @param {number} resampling  重投影后的采样参数，默认是 0，意义为：0: average, 1: bilinear, 2: cubic, 3: cubicspline, 4: lanczos, 5: mode, 6: nearestNeighbor。
 * @return void
 *
 * @author freegis
 */
function reprojectImage(src_ds, reproject_path, t_epsg, resampling = 1) {
  let s_ds;
  if (typeof (src_ds) === 'string')
    s_ds = gdal.open(src_ds);
  else
    s_ds = src_ds;
  // 获取源数据集的 坐标系
  const s_srs = s_ds.srs;
  // 投影的目标坐标系
  const t_srs = gdal.SpatialReference.fromEPSGA(t_epsg);
  // 输入源数据，源坐标系，目标坐标系，智能计算出输出的栅格像元分辨率和仿射变换参数
  const { rasterSize, geoTransform } = gdal.suggestedWarpOutput({
    src: s_ds,
    s_srs: s_srs,
    t_srs: t_srs
  });
  // 获取原始数据第一个band的数据类型，作为新的投影后的数据类型
  // 如果不写，类似默认是uint8，而dem是 int16，就会数据错误
  const dataType = s_ds.bands.get(1).dataType;
  // 使用源数据的驱动，保持文件格式不变
  const t_driver = s_ds.driver;
  //创建输出图像
  const t_ds = t_driver.create(reproject_path, rasterSize.x, rasterSize.y, s_ds.bands.count(), dataType);
  //重置索引和仿射变换参数
  t_ds.srs = t_srs;
  t_ds.geoTransform = geoTransform;
  //重采样方法
  let gdal_resampling = getResampling(resampling);
  gdal.reprojectImage({ src: s_ds, dst: t_ds, s_srs, t_srs, resampling: gdal_resampling });
  // 关闭退出
  t_ds.bands.get(1).noDataValue = s_ds.bands.get(1).noDataValue;
  t_ds.close();
  if (typeof (src_ds) === 'string')
    s_ds.close();
}



module.exports = {
  getDriverByName, reprojectImage, getBuildOverviewResampling
}