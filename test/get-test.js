'use strict'

const test = require('tape')
const testCommon = require('./common')

test('get() with resizable key', async function (t) {
  const buffer = new ArrayBuffer(2, { maxByteLength: 16 })

  // Requires Node.js >= 20
  if (!buffer.resizable) {
    t.pass('runtime does not support resizable ArrayBuffer')
    return
  }

  const db = testCommon.factory({ keyEncoding: 'buffer' })
  const key = new Uint8Array(buffer, 0, buffer.byteLength)

  await db.open()
  await db.put(key, 'foo')

  // Not a very meaningful test besides getting coverage
  t.is(await db.get(key), 'foo')

  return db.close()
})

test('getSync() with growing sharedBuffer', async function (t) {
  const db = testCommon.factory()
  await db.open()

  // Should be longer than the length in #createSharedBuffer()
  const longKey = Array(100).fill('0').join('')
  const shortKey = 'a'

  await db.put(shortKey, 'a')
  t.is(db.getSync(shortKey), 'a')

  await db.put(longKey, 'b')
  t.is(db.getSync(longKey), 'b')
})
