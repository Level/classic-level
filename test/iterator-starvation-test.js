'use strict'

const test = require('tape')
const testCommon = require('./common')
const sourceData = []

// For this test the number of entries in the db must be a multiple of
// the hardcoded limit in iterator.js (1000).
const limit = 1000

for (let i = 0; i < limit * 10; i++) {
  sourceData.push({
    type: 'put',
    key: i.toString(),
    value: ''
  })
}

test('iterator does not starve event loop', async function (t) {
  t.plan(2)

  const db = testCommon.factory()

  // Insert test data
  await db.open()
  await db.batch(sourceData.slice())

  // Set a high highWaterMarkBytes to fill up the cache entirely
  const it = db.iterator({ highWaterMarkBytes: Math.pow(1024, 3) })

  let breaths = 0
  let entries = 0
  let scheduled = false

  // Iterate continuously while also scheduling work with setImmediate(),
  // which should be given a chance to run because we limit the tick depth.
  const next = async function () {
    const entry = await it.next()

    if (entry === undefined) {
      t.is(entries, sourceData.length, 'got all data')
      t.is(breaths, sourceData.length / limit, 'breathed while iterating')

      return db.close()
    }

    entries++

    if (!scheduled) {
      scheduled = true
      setImmediate(function () {
        breaths++
        scheduled = false
      })
    }

    return next()
  }

  return next()
})

test('iterator with seeks does not starve event loop', async function (t) {
  t.plan(2)

  const db = testCommon.factory()

  await db.open()
  await db.batch(sourceData.slice())

  const it = db.iterator({ highWaterMarkBytes: Math.pow(1024, 3), limit: sourceData.length })

  let breaths = 0
  let entries = 0
  let scheduled = false

  const next = async function () {
    const entry = await it.next()

    if (entry === undefined) {
      t.is(entries, sourceData.length, 'got all data')
      t.is(breaths, sourceData.length - 1, 'breathed while iterating')

      return db.close()
    }

    entries++

    if (!scheduled) {
      // Seeking clears the cache, which should only have a positive
      // effect because it means the cache must be refilled, which
      // again gives us time to breathe. This is a smoke test, really.
      it.seek(sourceData[0].key)

      scheduled = true
      setImmediate(function () {
        breaths++
        scheduled = false
      })
    }

    return next()
  }

  return next()
})
