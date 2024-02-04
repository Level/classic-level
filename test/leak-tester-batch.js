'use strict'

const BUFFERS = false
const CHAINED = false

const testCommon = require('./common')
const crypto = require('crypto')

let writeCount = 0
let rssBase

function tick () {
  if (++writeCount % 100 === 0) {
    if (typeof global.gc !== 'undefined') global.gc()

    console.log(
      'writeCount =', writeCount, ', rss =',
      Math.round(process.memoryUsage().rss / rssBase * 100) + '%',
      Math.round(process.memoryUsage().rss / 1024 / 1024) + 'M'
    )
  }
}

const run = CHAINED
  ? async function () {
    const batch = db.batch()

    // TODO: a good amount of memory usage (and growth) comes from this code and not the db
    // itself, which makes the output difficult to interpret. See if we can use fixed data
    // without changing the meaning of the test. Same below (for non-chained).
    for (let i = 0; i < 100; i++) {
      let key = 'long key to test memory usage ' + String(Math.floor(Math.random() * 10000000))
      if (BUFFERS) key = Buffer.from(key)
      let value = crypto.randomBytes(1024)
      if (!BUFFERS) value = value.toString('hex')
      batch.put(key, value)
    }

    tick()
    return batch.write()
  }
  : async function () {
    const batch = []

    for (let i = 0; i < 100; i++) {
      let key = 'long key to test memory usage ' + String(Math.floor(Math.random() * 10000000))
      if (BUFFERS) key = Buffer.from(key)
      let value = crypto.randomBytes(1024)
      if (!BUFFERS) value = value.toString('hex')
      batch.push({ type: 'put', key, value })
    }

    tick()
    return db.batch(batch)
  }

const db = testCommon.factory()

db.open().then(async function () {
  rssBase = process.memoryUsage().rss
  while (true) await run()
})
