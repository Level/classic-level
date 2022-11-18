'use strict'

const BUFFERS = false

const testCommon = require('./common')
const crypto = require('crypto')

let putCount = 0
let getCount = 0
let iterations = 0

async function main () {
  const db = testCommon.factory()
  await db.open()

  const rssBase = process.memoryUsage().rss

  while (true) {
    let testKey = 'long key to test memory usage ' + String(Math.floor(Math.random() * 10000000))
    let testValue = crypto.randomBytes(1024)

    if (BUFFERS) {
      testKey = Buffer.from(testKey, 'utf8')
    } else {
      testValue = testValue.toString('hex')
    }

    const value = await db.get(testKey, { fillCache: false })

    if (value === undefined) {
      await db.put(testKey, testValue)
      putCount++
    } else {
      getCount++
    }

    if (iterations++ % 5e3 === 0) {
      if (typeof global.gc !== 'undefined') global.gc()

      console.log('getCount =', getCount, ', putCount = ', putCount, ', rss =',
        Math.round(process.memoryUsage().rss / rssBase * 100) + '%',
        Math.round(process.memoryUsage().rss / 1024 / 1024) + 'M'
      )
    }
  }
}

main().catch(function (err) {
  console.error(err)
  process.exit(1)
})
