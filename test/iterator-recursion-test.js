'use strict'

const test = require('tape')
const testCommon = require('./common')
const fork = require('child_process').fork
const path = require('path')

const sourceData = (function () {
  const d = []
  let i = 0
  let k
  for (; i < 100000; i++) {
    k = (i < 10 ? '0' : '') + i
    d.push({
      type: 'put',
      key: k,
      value: Math.random()
    })
  }
  return d
}())

// NOTE: this is an old leveldown test that asserts that we don't segfault if user code
// has an infinite loop leading to stack exhaustion, which caused a node::FatalException()
// call in our Iterator to segfault. This was fixed in 2014 (commit 85e6a38).
test('try to create an iterator with a blown stack', function (t) {
  t.plan(3)

  // Reducing the stack size down from the default 984 for the child node
  // process makes it easier to trigger the bug condition. But making it too low
  // causes the child process to die for other reasons.
  const opts = { execArgv: ['--stack-size=256'] }
  const child = fork(path.join(__dirname, 'stack-blower.js'), ['run'], opts)

  child.on('message', function (m) {
    t.ok(true, m)
    child.disconnect()
  })

  child.on('exit', function (code, sig) {
    t.is(code, 0, 'child exited normally')
    t.is(sig, null, 'not terminated due to signal')
  })
})

test('iterate over a large iterator with a large watermark', async function (t) {
  const db = testCommon.factory()

  await db.open()
  await db.batch(sourceData)

  const iterator = db.iterator({
    highWaterMarkBytes: 10000000
  })

  while (true) {
    const entry = await iterator.next()
    if (entry === undefined) break
  }

  return db.close()
})
