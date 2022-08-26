'use strict'

import TaskProcess from './pool.js'

const _processPools = [] // keep record of farms so we can end() them if required

/**
 * 创建进程池
 * @param {*} options 
 * @param {*} path 
 * @param {*} methods 
 * @returns 
 */
export default function initProcessPool(options, path, methods) {
  if (typeof options === 'string') {
    methods = path
    path = options
    options = {}
  }

  const taskProcess = new TaskProcess(options, path);
  const api = taskProcess.setup(methods);

  _processPools.push({
    process: taskProcess,
    api: api
  });
  api.process = taskProcess;
  // return the public API
  return api;
}

/**
 * 
 * @param {*} api 
 * @param {Function} callback 
 * @returns 
 */
export function end(api, callback) {
  for (let i = 0; i < _processPools.length; i++) {
    if (_processPools[i] && _processPools[i].api === api) {
      return _processPools[i].process.end(callback)
    }
  }

  process.nextTick(callback.bind(null, new Error('Worker process not found!')))
}
