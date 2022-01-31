'use strict'

const test = require('tape')
const testCommon = require('./common')
const noop = () => {}

let db

test('setUp db', function (t) {
  db = testCommon.factory()
  db.open(t.end.bind(t))
})

test('test compactRange() throws if arguments are missing', function (t) {
  for (const args of [[], ['foo'], [noop], ['foo', noop]]) {
    t.throws(() => db.compactRange(...args), {
      name: 'TypeError',
      message: "The arguments 'start' and 'end' are required"
    })
  }
  t.end()
})

test('test compactRange() frees disk space after key deletion', function (t) {
  const key1 = '000000'
  const key2 = '000001'
  const val1 = Buffer.allocUnsafe(64).fill(1)
  const val2 = Buffer.allocUnsafe(64).fill(1)

  db.batch().put(key1, val1).put(key2, val2).write(function (err) {
    t.ifError(err, 'no batch put error')

    db.compactRange(key1, key2, function (err) {
      t.ifError(err, 'no compactRange1 error')

      db.approximateSize('0', 'z', function (err, sizeAfterPuts) {
        t.error(err, 'no approximateSize1 error')

        db.batch().del(key1).del(key2).write(function (err) {
          t.ifError(err, 'no batch del error')

          db.compactRange(key1, key2, function (err) {
            t.ifError(err, 'no compactRange2 error')

            db.approximateSize('0', 'z', function (err, sizeAfterCompact) {
              t.error(err, 'no approximateSize2 error')
              t.ok(sizeAfterCompact < sizeAfterPuts)
              t.end()
            })
          })
        })
      })
    })
  })
})

test('tearDown', function (t) {
  db.close(t.end.bind(t))
})

test('test compactRange() yields error if db is closed', function (t) {
  db.compactRange('foo', 'foo', function (err) {
    t.is(err && err.code, 'LEVEL_DATABASE_NOT_OPEN')
    t.end()
  })
})

test('test compactRange() is deferred', async function (t) {
  const opening = db.open().then(() => 'opening')
  const deferred = db.compactRange('a', 'b').then(() => 'deferred')
  t.is(await Promise.race([opening, deferred]), 'opening')
  t.same(await Promise.all([opening, deferred]), ['opening', 'deferred'])
  return db.close()
})

// NOTE: copied from encoding-down
test('encodes start and end of compactRange()', async function (t) {
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
test('encodes start and end of compactRange() with custom encoding', async function (t) {
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
