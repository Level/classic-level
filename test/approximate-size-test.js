'use strict'

const test = require('tape')
const testCommon = require('./common')
const noop = () => {}

let db

test('setUp db', function (t) {
  db = testCommon.factory()
  db.open(t.end.bind(t))
})

test('test approximateSize() throws if arguments are missing', function (t) {
  for (const args of [[], ['foo'], [noop], ['foo', noop]]) {
    t.throws(() => db.approximateSize(...args), {
      name: 'TypeError',
      message: "The arguments 'start' and 'end' are required"
    })
  }
  t.end()
})

test('test approximateSize()', function (t) {
  const data = Array.apply(null, Array(10000)).map(function () {
    return 'aaaaaaaaaa'
  }).join('')

  db.batch(Array.apply(null, Array(10)).map(function (x, i) {
    return { type: 'put', key: 'foo' + i, value: data }
  }), function (err) {
    t.error(err)

    // cycle open/close to ensure a pack to .sst

    db.close(function (err) {
      t.error(err)

      db.open(function (err) {
        t.error(err)

        db.approximateSize('!', '~', function (err, size) {
          t.error(err)

          t.equal(typeof size, 'number')
          // account for snappy compression, original would be ~100000
          t.ok(size > 40000, 'size reports a reasonable amount (' + size + ')')
          t.end()
        })
      })
    })
  })
})

test('tearDown', function (t) {
  db.close(t.end.bind(t))
})

test('test approximateSize() yields error if db is closed', function (t) {
  db.approximateSize('foo', 'foo', function (err) {
    t.is(err && err.code, 'LEVEL_DATABASE_NOT_OPEN')
    t.end()
  })
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
