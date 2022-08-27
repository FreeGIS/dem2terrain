'use strict'
import os from 'node:os'
import errno from 'errno'
import fork from './fork.js'

export const TimeoutError = errno.create('TimeoutError')
const ProcessTerminatedError = errno.create('ProcessTerminatedError')
const MaxConcurrentCallsError = errno.create('MaxConcurrentCallsError')

const DEFAULT_OPTIONS = {
  workerOptions: {},
  maxCallsPerWorker: Infinity,
  maxConcurrentWorkers: (os.cpus() || { length: 1 }).length,
  maxConcurrentCallsPerWorker: 10,
  maxConcurrentCalls: Infinity,
  maxCallTime: Infinity, // exceed this and the whole worker is terminated
  maxRetries: Infinity,
  forcedKillTime: 100,
  autoStart: false,
  onChild: function () { }
}

export default class TaskProcess {
  constructor(options, path) {
    this.options = Object.assign({}, DEFAULT_OPTIONS, options)
    this.path = path
    this.activeCalls = 0
  }
  // make a handle to pass back in the form of an external API
  mkhandle(method) {
    return function () {
      let args = Array.prototype.slice.call(arguments)
      if (this.activeCalls + this.callQueue.length >= this.options.maxConcurrentCalls) {
        let err = new MaxConcurrentCallsError('Too many concurrent calls (active: ' + this.activeCalls + ', queued: ' + this.callQueue.length + ')')
        if (typeof args[args.length - 1] == 'function')
          return process.nextTick(args[args.length - 1].bind(null, err))
        throw err
      }
      this.addCall({
        method: method,
        callback: args.pop(),
        args: args,
        retries: 0
      })
    }.bind(this)
  }
  // a constructor of sorts
  setup(methods) {
    let iface
    if (!methods) { // single-function export
      iface = this.mkhandle()
    } else { // multiple functions on the export
      iface = {}
      methods.forEach(function (m) {
        iface[m] = this.mkhandle(m)
      }.bind(this))
    }

    this.searchStart = -1
    this.childId = -1
    this.children = {}
    this.activeChildren = 0
    this.callQueue = []

    if (this.options.autoStart) {
      while (this.activeChildren < this.options.maxConcurrentWorkers)
        this.startChild()
    }

    return iface
  }
  // when a child exits, check if there are any outstanding jobs and requeue them
  onExit(childId) {
    // delay this to give any sends a chance to finish
    setTimeout(function () {
      let doQueue = false
      if (this.children[childId] && this.children[childId].activeCalls) {
        this.children[childId].calls.forEach(function (call, i) {
          if (!call)
            return
          else if (call.retries >= this.options.maxRetries) {
            this.receive({
              idx: i,
              child: childId,
              args: [new ProcessTerminatedError('cancel after ' + call.retries + ' retries!')]
            })
          } else {
            call.retries++
            this.callQueue.unshift(call)
            doQueue = true
          }
        }.bind(this))
      }
      this.stopChild(childId)
      doQueue && this.processQueue()
    }.bind(this), 10)
  }
  // start a new worker
  startChild() {
    this.childId++

    let forked = fork(this.path, this.options.workerOptions), id = this.childId, c = {
      send: forked.send,
      child: forked.child,
      calls: [],
      activeCalls: 0,
      exitCode: null
    }

    this.options.onChild(forked.child)

    forked.child.on('message', function (data) {
      if (data.owner !== 'farm') {
        return
      }
      this.receive(data)
    }.bind(this))
    forked.child.once('exit', function (code) {
      c.exitCode = code
      this.onExit(id)
    }.bind(this))

    this.activeChildren++
    this.children[id] = c
  }
  // stop a worker, identified by id
  stopChild(childId) {
    let child = this.children[childId]
    if (child) {
      child.send({ owner: 'farm', event: 'die' })
      setTimeout(function () {
        if (child.exitCode === null)
          child.child.kill('SIGKILL')
      }, this.options.forcedKillTime).unref(); delete this.children[childId]
      this.activeChildren--
    }
  }
  // called from a child process, the data contains information needed to
  // look up the child and the original call so we can invoke the callback
  receive(data) {
    let idx = data.idx, childId = data.child, args = data.args, child = this.children[childId], call

    if (!child) {
      return
    }

    call = child.calls[idx]
    if (!call) {

      return
    }

    if (this.options.maxCallTime !== Infinity)
      clearTimeout(call.timer)

    if (args[0] && args[0].$error == '$error') {
      let e = args[0]
      switch (e.type) {
        case 'TypeError': args[0] = new TypeError(e.message); break
        case 'RangeError': args[0] = new RangeError(e.message); break
        case 'EvalError': args[0] = new EvalError(e.message); break
        case 'ReferenceError': args[0] = new ReferenceError(e.message); break
        case 'SyntaxError': args[0] = new SyntaxError(e.message); break
        case 'URIError': args[0] = new URIError(e.message); break
        default: args[0] = new Error(e.message)
      }
      args[0].type = e.type
      args[0].stack = e.stack

      // Copy any custom properties to pass it on.
      Object.keys(e).forEach(function (key) {
        args[0][key] = e[key]
      })
    }

    process.nextTick(function () {
      call.callback.apply(null, args)
    }); delete child.calls[idx]
    child.activeCalls--
    this.activeCalls--

    if (child.calls.length >= this.options.maxCallsPerWorker
      && !Object.keys(child.calls).length) {
      // this child has finished its run, kill it
      this.stopChild(childId)
    }

    // allow any outstanding calls to be processed
    this.processQueue()
  }
  childTimeout(childId) {
    let child = this.children[childId], i

    if (!child)
      return

    for (i in child.calls) {
      this.receive({
        idx: i,
        child: childId,
        args: [new TimeoutError('worker call timed out!')]
      })
    }
    this.stopChild(childId)
  }
  // send a call to a worker, identified by id
  send(childId, call) {
    let child = this.children[childId], idx = child.calls.length

    child.calls.push(call)
    child.activeCalls++
    this.activeCalls++

    child.send({
      owner: 'farm',
      idx: idx,
      child: childId,
      method: call.method,
      args: call.args
    })

    if (this.options.maxCallTime !== Infinity) {
      call.timer =
        setTimeout(this.childTimeout.bind(this, childId), this.options.maxCallTime)
    }
  }
  // a list of active worker ids, in order, but the starting offset is
  // shifted each time this method is called, so we work our way through
  // all workers when handing out jobs
  childKeys() {
    let cka = Object.keys(this.children), cks

    if (this.searchStart >= cka.length - 1)
      this.searchStart = 0

    else
      this.searchStart++

    cks = cka.splice(0, this.searchStart)

    return cka.concat(cks)
  }
  // Calls are added to a queue, this processes the queue and is called
  // whenever there might be a chance to send more calls to the workers.
  // The various options all impact on when we're able to send calls,
  // they may need to be kept in a queue until a worker is ready.
  processQueue() {
    let cka, i = 0, childId

    if (!this.callQueue.length)
      return this.ending && this.end()

    if (this.activeChildren < this.options.maxConcurrentWorkers)
      this.startChild()

    for (cka = this.childKeys(); i < cka.length; i++) {
      childId = +cka[i]
      if (this.children[childId].activeCalls < this.options.maxConcurrentCallsPerWorker
        && this.children[childId].calls.length < this.options.maxCallsPerWorker) {

        this.send(childId, this.callQueue.shift())
        if (!this.callQueue.length)
          return this.ending && this.end()
      } /*else {
              console.log(
                , this.children[childId].activeCalls < this.options.maxConcurrentCallsPerWorker
                , this.children[childId].calls.length < this.options.maxCallsPerWorker
                , this.children[childId].calls.length , this.options.maxCallsPerWorker)
            }*/





    }

    if (this.ending)
      this.end()
  }
  // add a new call to the call queue, then trigger a process of the queue
  addCall(call) {
    if (this.ending)
      return this.end() // don't add anything new to the queue
    this.callQueue.push(call)
    this.processQueue()
  }
  // kills child workers when they're all done
  end(callback) {
    let complete = true
    if (this.ending === false)
      return
    if (callback)
      this.ending = callback
    else if (this.ending == null)
      this.ending = true
    Object.keys(this.children).forEach(function (child) {
      if (!this.children[child])
        return
      if (!this.children[child].activeCalls)
        this.stopChild(child)

      else
        complete = false
    }.bind(this))

    if (complete && typeof this.ending == 'function') {
      process.nextTick(function () {
        this.ending()
        this.ending = false
      }.bind(this))
    }
  }
}
