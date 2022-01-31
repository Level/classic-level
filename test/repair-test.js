'use strict'

const test = require('tape')
const fs = require('fs')
const { ClassicLevel } = require('..')
const makeTest = require('./make')

test('test repair() without location throws', function (t) {
  t.throws(ClassicLevel.repair, {
    name: 'TypeError',
    message: "The first argument 'location' must be a non-empty string"
  })
  t.throws(() => ClassicLevel.repair(''), {
    name: 'TypeError',
    message: "The first argument 'location' must be a non-empty string"
  })
  t.end()
})

test('test repair non-existent directory returns error', function (t) {
  ClassicLevel.repair('/1/2/3/4', function (err) {
    if (process.platform !== 'win32') {
      t.ok(/no such file or directory/i.test(err), 'error on callback')
    } else {
      t.ok(/IO error/i.test(err), 'error on callback')
    }
    t.end()
  })
})

// a proxy indicator that RepairDB is being called and doing its thing
makeTest('test repair() compacts', function (db, t, done) {
  const location = db.location

  db.close(function (err) {
    t.ifError(err, 'no error from close()')

    let files = fs.readdirSync(location)
    t.ok(files.some(function (f) { return (/\.log$/).test(f) }), 'directory contains log file(s)')
    t.notOk(files.some(function (f) { return (/\.ldb$/).test(f) }), 'directory does not contain ldb file(s)')

    ClassicLevel.repair(location, function (err) {
      t.ifError(err, 'no error from repair()')

      files = fs.readdirSync(location)
      t.notOk(files.some(function (f) { return (/\.log$/).test(f) }), 'directory does not contain log file(s)')
      t.ok(files.some(function (f) { return (/\.ldb$/).test(f) }), 'directory contains ldb file(s)')

      done(null, false)
    })
  })
})
