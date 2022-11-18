'use strict'

const test = require('tape')
const testCommon = require('./common')

// When we have a chained batch object without a reference, V8 might GC it
// before we get a chance to (asynchronously) write the batch.
test('chained batch without ref does not get GCed before write', async function (t) {
  const db = testCommon.factory()
  await db.open()

  let batch = db.batch()

  for (let i = 0; i < 1e3; i++) {
    batch.put(String(i), 'value')
  }

  // The sync option makes the operation slower and thus more likely to
  // cause a segfault (if the batch were to be GC-ed before it is written).
  const promise = batch.write({ sync: true })

  // Remove reference
  batch = null

  if (global.gc) {
    // This is the reliable way to trigger GC (and the bug if it exists).
    // Useful for manual testing with "node --expose-gc".
    global.gc()
  }

  return promise
})
