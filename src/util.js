const s4 = () => {
  return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
}

/**
 * 获取随机 uuid
 * @returns {string}
 */
const uuid = () => {
  return (s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4());
}


/**
 * 将毫秒转换为更合适显示的时间数字和单位
 * @param {number} timeInMs 
 * @returns {{
 *   resultTime: number;
 *   unit: 'ms' | 'sec' | 'min' | 'hour';
 * }}
 */
const prettyTime = (timeInMs) => {
  let result = 0
  let unit = 'ms'
  if (timeInMs < 1000) {
    result = timeInMs
  } else if (timeInMs < 60 * 1000) {
    result = timeInMs / 1000
    unit = 'sec'
  } else if (timeInMs < 60 * 60 * 1000) {
    result = timeInMs / (60 * 1000)
    unit = 'min'
  } else {
    result = timeInMs / (60 * 60 * 1000)
    unit = 'hour'
  }
  return {
    resultTime: result,
    unit
  }
}


module.exports = {
  uuid, prettyTime
}