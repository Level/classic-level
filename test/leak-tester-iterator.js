'use strict'

const db = require('./common').factory()

let count = 0
let rssBase

if (!global.gc) {
  console.error('To force GC, run with "node --expose-gc"')
}

async function run () {
  while (true) {
    const it = db.iterator()

    await it.next()
    await it.close()

    if (!rssBase) {
      rssBase = process.memoryUsage().rss
    }

    if (++count % 1000 === 0) {
      if (global.gc) global.gc()

      const rss = process.memoryUsage().rss
      const percent = Math.round((rss / rssBase) * 100)
      const mb = Math.round(rss / 1024 / 1024)

      console.log('count = %d, rss = %d% %dM', count, percent, mb)
    }
  }
}

async function main () {
  await db.open()
  await db.put('key', 'value')
  await run()
}

main().catch(function (err) {
  console.error(err)
  process.exit(1)
})
