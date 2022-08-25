const fs = require('fs');
const path = require('path');

function uuid() {
  function s4() {
    return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
  }
  return (s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4());
}

//根据文件，同步递归创建其上一级目录
function createDirs(file) {
  //获取文件根目录
  let dirpath = path.dirname(file);
  //有路径直接回调走
  if (fs.existsSync(dirpath)) {
    return true;
  } else {
    if (createDirs(dirpath)) {
      try {
        // 并发时有问题，查询时无，创建时别的子进程已经创建
        fs.mkdirSync(dirpath);
      } catch {

      }
      return true;
    }
  }
};

module.exports = {
  uuid, createDirs
}