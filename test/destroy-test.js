'use strict'

const test = require('tape')
const tempy = require('tempy')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const mkfiletree = require('mkfiletree')
const readfiletree = require('readfiletree')
const rimraf = require('rimraf')
const { ClassicLevel } = require('..')
const makeTest = require('./make')

test('test destroy() without location throws', async function (t) {
  t.plan(2 * 2)

  for (const args of [[], ['']]) {
    try {
      await ClassicLevel.destroy(...args)
    } catch (err) {
      t.is(err.name, 'TypeError')
      t.is(err.message, "The first argument 'location' must be a non-empty string")
    }
  }
})

test('test destroy non-existent directory', function (t) {
  t.plan(3)

  const location = tempy.directory()
  const parent = path.dirname(location)

  // For symmetry with the opposite test below.
  t.ok(fs.existsSync(parent), 'parent exists before')

  // Cleanup to avoid conflicts with other tests
  // TODO: use promise
  rimraf(location, { glob: false }, function (err) {
    t.ifError(err, 'no error from rimraf()')

    ClassicLevel.destroy(location).then(function () {
      // Assert that destroy() didn't inadvertently create the directory.
      // Or if it did, that it was at least cleaned up afterwards.
      t.notOk(fs.existsSync(location), 'directory does not exist after')
    }, t.fail.bind(t))
  })
})

test('test destroy non-existent parent directory', function (t) {
  t.plan(2)

  const location = '/1/2/3/4'
  const parent = path.dirname(location)

  t.notOk(fs.existsSync(parent), 'parent does not exist before')

  ClassicLevel.destroy(location).then(function () {
    t.notOk(fs.existsSync(location), 'directory does not exist after')
  }, t.fail.bind(t))
})

test('test destroy non leveldb directory', function (t) {
  const tree = {
    foo: 'FOO',
    bar: { one: 'ONE', two: 'TWO', three: 'THREE' }
  }

  // TODO: use promise and/or simplify this test
  mkfiletree.makeTemp('destroy-test', tree, function (err, dir) {
    t.ifError(err, 'no error from makeTemp()')

    ClassicLevel.destroy(dir).then(function () {
      readfiletree(dir, function (err, actual) {
        t.ifError(err, 'no error from readfiletree()')
        t.deepEqual(actual, tree, 'directory remains untouched')

        mkfiletree.cleanUp(function (err) {
          t.ifError(err, 'no error from cleanup()')
          t.end()
        })
      })
    }, t.fail.bind(t))
  })
})

makeTest('test destroy() cleans and removes leveldb-only dir', async function (db, t) {
  const location = db.location

  await db.close()
  await ClassicLevel.destroy(location)

  t.notOk(fs.existsSync(location), 'directory completely removed')
})

makeTest('test destroy() cleans and removes only leveldb parts of a dir', async function (db, t) {
  const location = db.location
  fs.writeFileSync(path.join(location, 'foo'), 'FOO')

  await db.close()
  await ClassicLevel.destroy(location)

  t.same(await fsp.readdir(location), ['foo'], 'non-leveldb files left intact')
  t.same(await fsp.readFile(path.join(location, 'foo'), 'utf8'), 'FOO', 'content left intact')
})
