'use strict'

const test = require('tape')
const testCommon = require('./common')
const operations = []

// The db must wait for pending operations to finish before closing. This to
// prevent segfaults and in the case of compactRange() to prevent hanging. See
// https://github.com/Level/leveldown/issues/157 and 32.
function testPending (name, fn) {
  operations.push(fn)

  test(`close() waits for pending ${name}`, async function (t) {
    const db = testCommon.factory()
    let finished = false

    await db.open()
    await db.put('key', 'value')

    fn(db).then(function () {
      finished = true
    })

    return db.close().then(function () {
      t.is(finished, true, 'operation(s) finished before close')
    })
  })
}

testPending('get()', async function (db) {
  return db.get('key')
})

testPending('put()', async function (db) {
  return db.put('key2', 'value')
})

testPending('put() with { sync }', async function (db) {
  // The sync option makes the operation slower and thus more likely to
  // cause a segfault (if closing were to happen during the operation).
  return db.put('key2', 'value', { sync: true })
})

testPending('del()', async function (db) {
  return db.del('key')
})

testPending('del() with { sync }', async function (db) {
  return db.del('key', { sync: true })
})

testPending('batch([])', async function (db) {
  return db.batch([{ type: 'del', key: 'key' }])
})

testPending('batch([]) with { sync }', async function (db) {
  return db.batch([{ type: 'del', key: 'key' }], { sync: true })
})

testPending('batch()', async function (db) {
  return db.batch().del('key').write()
})

testPending('batch() with { sync }', async function (db) {
  return db.batch().del('key').write({ sync: true })
})

testPending('approximateSize()', async function (db) {
  return db.approximateSize('a', 'z')
})

testPending('compactRange()', async function (db) {
  return db.compactRange('a', 'z')
})

// Test multiple pending operations, using all of the above.
testPending('operations', async function (db) {
  return Promise.all(operations.slice(0, -1).map(fn => fn(db)))
})
