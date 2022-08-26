import { fork as sysFork } from 'node:child_process'

export default function fork(forkModule, workerOptions) {
  // suppress --debug / --inspect flags while preserving others (like --harmony)
  const filteredArgs = process.execArgv.filter((v) => {
    return !(/^--(debug|inspect)/).test(v)
  })
  const options = Object.assign({
    execArgv: filteredArgs,
    env: process.env,
    cwd: process.cwd()
  }, workerOptions)
  const child = sysFork('./child.js', process.argv, options)

  child.on('error', () => {
    // this *should* be picked up by onExit and the operation requeued
  })

  child.send({
    owner: 'farm',
    module: forkModule
  })

  // return a send() function for this child
  return {
    send: child.send.bind(child),
    child: child
  }
}
