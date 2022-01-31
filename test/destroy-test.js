'use strict'

const test = require('tape')
const tempy = require('tempy')
const fs = require('fs')
const path = require('path')
const mkfiletree = require('mkfiletree')
const readfiletree = require('readfiletree')
const rimraf = require('rimraf')
const { ClassicLevel } = require('..')
const makeTest = require('./make')

test('test destroy() without location throws', function (t) {
  t.throws(ClassicLevel.destroy, {
    name: 'TypeError',
    message: "The first argument 'location' must be a non-empty string"
  })
  t.throws(() => ClassicLevel.destroy(''), {
    name: 'TypeError',
    message: "The first argument 'location' must be a non-empty string"
  })
  t.end()
})

test('test destroy non-existent directory', function (t) {
  t.plan(4)

  const location = tempy.directory()
  const parent = path.dirname(location)

  // For symmetry with the opposite test below.
  t.ok(fs.existsSync(parent), 'parent exists before')

  // Cleanup to avoid conflicts with other tests
  rimraf(location, { glob: false }, function (err) {
    t.ifError(err, 'no error from rimraf()')

    ClassicLevel.destroy(location, function (err) {
      t.error(err, 'no error')

      // Assert that destroy() didn't inadvertently create the directory.
      // Or if it did, that it was at least cleaned up afterwards.
      t.notOk(fs.existsSync(location), 'directory does not exist after')
    })
  })
})

test('test destroy non-existent parent directory', function (t) {
  t.plan(3)

  const location = '/1/2/3/4'
  const parent = path.dirname(location)

  t.notOk(fs.existsSync(parent), 'parent does not exist before')

  ClassicLevel.destroy(location, function (err) {
    t.error(err, 'no error')
    t.notOk(fs.existsSync(location), 'directory does not exist after')
  })
})

test('test destroy non leveldb directory', function (t) {
  const tree = {
    foo: 'FOO',
    bar: { one: 'ONE', two: 'TWO', three: 'THREE' }
  }

  mkfiletree.makeTemp('destroy-test', tree, function (err, dir) {
    t.ifError(err, 'no error from makeTemp()')

    ClassicLevel.destroy(dir, function (err) {
      t.ifError(err, 'no error from destroy()')

      readfiletree(dir, function (err, actual) {
        t.ifError(err, 'no error from readfiletree()')
        t.deepEqual(actual, tree, 'directory remains untouched')

        mkfiletree.cleanUp(function (err) {
          t.ifError(err, 'no error from cleanup()')
          t.end()
        })
      })
    })
  })
})

makeTest('test destroy() cleans and removes leveldb-only dir', function (db, t, done) {
  const location = db.location
  db.close(function (err) {
    t.ifError(err, 'no error from close()')

    ClassicLevel.destroy(location, function (err) {
      t.ifError(err, 'no error from destroy()')
      t.notOk(fs.existsSync(location), 'directory completely removed')

      done(null, false)
    })
  })
})

makeTest('test destroy() cleans and removes only leveldb parts of a dir', function (db, t, done) {
  const location = db.location
  fs.writeFileSync(path.join(location, 'foo'), 'FOO')

  db.close(function (err) {
    t.ifError(err, 'no error from close()')

    ClassicLevel.destroy(location, function (err) {
      t.ifError(err, 'no error from destroy()')

      readfiletree(location, function (err, tree) {
        t.ifError(err, 'no error from readfiletree()')
        t.deepEqual(tree, { foo: 'FOO' }, 'non-leveldb files left intact')

        done(null, false)
      })
    })
  })
})
