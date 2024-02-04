'use strict'

const test = require('tape')
const testCommon = require('./common')
const sourceData = []

for (let i = 0; i < 1e3; i++) {
  sourceData.push({
    type: 'put',
    key: i.toString(),
    value: Math.random().toString()
  })
}

test('db without ref does not get GCed while clear() is in progress', async function (t) {
  let db = testCommon.factory()

  await db.open()
  await db.batch(sourceData.slice())

  // Start async work
  const promise = db.clear()

  // Remove reference. The db should not get garbage collected
  // until after the clear() callback, thanks to a napi_ref.
  db = null

  // Useful for manual testing with "node --expose-gc".
  // The pending tap assertion may also allow GC to kick in.
  if (global.gc) global.gc()

  return promise
})
