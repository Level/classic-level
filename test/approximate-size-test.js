'use strict'

const test = require('tape')
const testCommon = require('./common')

let db

test('approximateSize() setup', async function (t) {
  db = testCommon.factory()
  return db.open()
})

test('approximateSize() throws if arguments are missing', async function (t) {
  t.plan(2 * 2)

  for (const args of [[], ['foo']]) {
    try {
      await db.approximateSize(...args)
    } catch (err) {
      t.is(err.name, 'TypeError')
      t.is(err.message, "The arguments 'start' and 'end' are required")
    }
  }
})

test('approximateSize()', async function (t) {
  const data = Array.apply(null, Array(10000)).map(function () {
    return 'aaaaaaaaaa'
  }).join('')

  await db.batch(Array.apply(null, Array(10)).map(function (x, i) {
    return { type: 'put', key: 'foo' + i, value: data }
  }))

  // cycle open/close to ensure a pack to .sst
  await db.close()
  await db.open()

  const size = await db.approximateSize('!', '~')

  t.equal(typeof size, 'number')
  // account for snappy compression, original would be ~100000
  t.ok(size > 40000, 'size reports a reasonable amount (' + size + ')')
})

test('approximateSize() teardown', async function (t) {
  return db.close()
})

test('approximateSize() yields error if db is closed', async function (t) {
  t.plan(1)

  try {
    await db.approximateSize('foo', 'foo')
  } catch (err) {
    t.is(err.code, 'LEVEL_DATABASE_NOT_OPEN')
  }
})

test('test approximateSize() is deferred', async function (t) {
  const opening = db.open().then(() => 'opening')
  const deferred = db.approximateSize('a', 'b').then(() => 'deferred')
  t.is(await Promise.race([opening, deferred]), 'opening')
  t.same(await Promise.all([opening, deferred]), ['opening', 'deferred'])
  return db.close()
})

// NOTE: adapted from encoding-down
test('encodes start and end of approximateSize()', async function (t) {
  const calls = []
  const keyEncoding = {
    name: 'test',
    format: 'utf8',
    encode (key) {
      calls.push(key)
      return key
    },
    decode: (v) => v
  }
  const db = testCommon.factory({ keyEncoding })
  await db.open()
  await db.approximateSize('a', 'b')
  t.same(calls, ['a', 'b'])
  return db.close()
})

// NOTE: adapted from encoding-down
test('encodes start and end of approximateSize() with custom encoding', async function (t) {
  const calls = []
  const keyEncoding = {
    name: 'test',
    format: 'utf8',
    encode (key) {
      calls.push(key)
      return key
    },
    decode: (v) => v
  }
  const db = testCommon.factory()
  await db.open()
  await db.approximateSize('a', 'b', { keyEncoding })
  t.same(calls, ['a', 'b'])
  return db.close()
})
