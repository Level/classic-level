'use strict'

const test = require('tape')
const testCommon = require('./common')

let db

test('compactRange() setup', async function (t) {
  db = testCommon.factory()
  return db.open()
})

test('compactRange() throws if arguments are missing', async function (t) {
  t.plan(2 * 2)

  for (const args of [[], ['foo']]) {
    try {
      await db.compactRange(...args)
    } catch (err) {
      t.is(err.name, 'TypeError')
      t.is(err.message, "The arguments 'start' and 'end' are required")
    }
  }
})

test('compactRange() frees disk space after key deletion', async function (t) {
  const key1 = '000000'
  const key2 = '000001'
  const val1 = Buffer.allocUnsafe(64).fill(1)
  const val2 = Buffer.allocUnsafe(64).fill(1)

  await db.batch().put(key1, val1).put(key2, val2).write()
  await db.compactRange(key1, key2)

  const sizeAfterPuts = await db.approximateSize('0', 'z')

  await db.batch().del(key1).del(key2).write()
  await db.compactRange(key1, key2)

  const sizeAfterCompact = await db.approximateSize('0', 'z')
  t.ok(sizeAfterCompact < sizeAfterPuts)
})

test('compactRange() teardown', async function (t) {
  return db.close()
})

test('compactRange() yields error if db is closed', async function (t) {
  t.plan(1)

  try {
    await db.compactRange('foo', 'foo')
  } catch (err) {
    t.is(err.code, 'LEVEL_DATABASE_NOT_OPEN')
  }
})

test('compactRange() is deferred', async function (t) {
  const opening = db.open().then(() => 'opening')
  const deferred = db.compactRange('a', 'b').then(() => 'deferred')
  t.is(await Promise.race([opening, deferred]), 'opening')
  t.same(await Promise.all([opening, deferred]), ['opening', 'deferred'])
  return db.close()
})

// NOTE: copied from encoding-down
test('compactRange() encodes start and end', async function (t) {
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
  await db.compactRange('a', 'b')
  t.same(calls, ['a', 'b'])
  return db.close()
})

// NOTE: adapted from encoding-down
test('compactRange() encodes start and end with custom encoding', async function (t) {
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
  await db.compactRange('a', 'b', { keyEncoding })
  t.same(calls, ['a', 'b'])
  return db.close()
})
