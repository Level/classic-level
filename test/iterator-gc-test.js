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

// When you have a database open with an active iterator, but no references to
// the db, V8 will GC the database and you'll get an failed assert from LevelDB.
test('db without ref does not get GCed while iterating', async function (t) {
  let db = testCommon.factory()

  await db.open()

  // Insert test data
  await db.batch(sourceData.slice())

  // Set highWaterMarkBytes to 0 so that we don't preemptively fetch.
  const it = db.iterator({ highWaterMarkBytes: 0 })

  // Remove reference
  db = null

  if (global.gc) {
    // This is the reliable way to trigger GC (and the bug if it exists).
    // Useful for manual testing with "node --expose-gc".
    global.gc()
  } else {
    // But a timeout usually also allows GC to kick in. If not, the time
    // between iterator ticks might. That's when "highWaterMarkBytes: 0" helps.
    await new Promise(resolve => setTimeout(resolve, 1e3))
  }

  // No reference to db here, could be GCed. It shouldn't..
  const entries = await it.all()
  t.is(entries.length, sourceData.length, 'got data')

  // Because we also have a reference on the iterator. That's the fix.
  t.ok(it.db, 'abstract iterator has reference to db')

  // Which as luck would have it, also allows us to properly end this test.
  return it.db.close()
})

// Same as above but also nullifying the iterator
test('db and iterator without ref does not get GCed while iterating', async function (t) {
  let db = testCommon.factory()

  await db.open()
  await db.batch(sourceData.slice())

  let it = db.iterator({
    highWaterMarkBytes: sourceData.length * 32
  })

  t.is((await it.nextv(1000)).length, sourceData.length, 'got data')

  // Remove references
  it = null
  db = null

  if (global.gc) {
    global.gc()
  } else {
    await new Promise(resolve => setTimeout(resolve, 1e3))
  }
})
