'use strict'

const test = require('tape')
const testCommon = require('./common')

let db

test('getProperty() setup', async function (t) {
  db = testCommon.factory()
  return db.open()
})

test('argument-less getProperty() throws', function (t) {
  t.throws(db.getProperty.bind(db), {
    name: 'TypeError',
    message: "The first argument 'property' must be a string"
  })
  t.end()
})

test('non-string getProperty() throws', function (t) {
  t.throws(db.getProperty.bind(db, {}), {
    name: 'TypeError',
    message: "The first argument 'property' must be a string"
  })
  t.end()
})

test('invalid getProperty() returns empty string', function (t) {
  t.equal(db.getProperty('foo'), '', 'invalid property')
  t.equal(db.getProperty('leveldb.foo'), '', 'invalid leveldb.* property')
  t.end()
})

test('invalid getProperty("leveldb.num-files-at-levelN") returns numbers', function (t) {
  for (let i = 0; i < 7; i++) {
    t.equal(db.getProperty('leveldb.num-files-at-level' + i),
      '0', '"leveldb.num-files-at-levelN" === "0"')
  }
  t.end()
})

test('invalid getProperty("leveldb.stats")', function (t) {
  t.ok(db.getProperty('leveldb.stats').split('\n').length > 3, 'leveldb.stats has > 3 newlines')
  t.end()
})

test('invalid getProperty("leveldb.sstables")', function (t) {
  const expected = [0, 1, 2, 3, 4, 5, 6].map(function (l) {
    return '--- level ' + l + ' ---'
  }).join('\n') + '\n'
  t.equal(db.getProperty('leveldb.sstables'), expected, 'leveldb.sstables')
  t.end()
})

test('getProperty() teardown', async function (t) {
  return db.close()
})

test('getProperty() throws if db is closed', function (t) {
  t.throws(() => db.getProperty('leveldb.stats'), {
    code: 'LEVEL_DATABASE_NOT_OPEN'
  })
  t.end()
})
