'use strict'

const du = require('du')
const testCommon = require('./common')
const { ClassicLevel } = require('..')
const test = require('tape')

const compressableData = Buffer.from(Array.apply(null, Array(1024 * 100)).map(function () {
  return 'aaaaaaaaaa'
}).join(''))

const multiples = 10
const dataSize = compressableData.length * multiples

const verify = function (location, compression, t) {
  return new Promise(function (resolve, reject) {
    du(location, function (err, size) {
      if (err) return reject(err)

      if (compression) {
        t.ok(size < dataSize, 'on-disk size (' + size + ') is less than data size (' + dataSize + ')')
      } else {
        t.ok(size >= dataSize, 'on-disk size (' + size + ') is greater than data size (' + dataSize + ')')
      }

      resolve()
    })
  })
}

// close, open, close again.. 'compaction' is also performed on open()s
const cycle = async function (db, compression) {
  const location = db.location
  await db.close()
  db = new ClassicLevel(location)
  await db.open({ errorIfExists: false, compression })
  return db.close()
}

test('compression', function (t) {
  t.plan(4)

  t.test('data is compressed by default (db.put())', async function (t) {
    const db = testCommon.factory()
    await db.open()

    const promises = Array.apply(null, Array(multiples)).map(function (e, i) {
      return db.put(String(i), compressableData)
    })

    await Promise.all(promises)
    await cycle(db, true)
    await verify(db.location, true, t)
  })

  t.test('data is not compressed with compression=false on open() (db.put())', async function (t) {
    const db = testCommon.factory()
    await db.open({ compression: false })

    const promises = Array.apply(null, Array(multiples)).map(function (e, i) {
      return db.put(String(i), compressableData)
    })

    await Promise.all(promises)
    await cycle(db, false)
    await verify(db.location, false, t)
  })

  t.test('data is compressed by default (db.batch())', async function (t) {
    const db = testCommon.factory()
    await db.open()

    const operations = Array.apply(null, Array(multiples)).map(function (e, i) {
      return { type: 'put', key: String(i), value: compressableData }
    })

    await db.batch(operations)
    await cycle(db, true)
    await verify(db.location, true, t)
  })

  t.test('data is not compressed with compression=false on factory (db.batch())', async function (t) {
    const db = testCommon.factory({ compression: false })
    await db.open()

    const operations = Array.apply(null, Array(multiples)).map(function (e, i) {
      return { type: 'put', key: String(i), value: compressableData }
    })

    await db.batch(operations)
    await cycle(db, false)
    await verify(db.location, false, t)
  })
})
