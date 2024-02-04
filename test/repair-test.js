'use strict'

const test = require('tape')
const fsp = require('fs/promises')
const { ClassicLevel } = require('..')
const makeTest = require('./make')

test('test repair() without location throws', async function (t) {
  t.plan(2 * 2)

  for (const args of [[], ['']]) {
    try {
      await ClassicLevel.repair(...args)
    } catch (err) {
      t.is(err.name, 'TypeError')
      t.is(err.message, "The first argument 'location' must be a non-empty string")
    }
  }
})

test('test repair non-existent directory returns error', async function (t) {
  t.plan(1)

  try {
    await ClassicLevel.repair('/1/2/3/4')
  } catch (err) {
    if (process.platform !== 'win32') {
      t.ok(/no such file or directory/i.test(err), 'error')
    } else {
      t.ok(/IO error/i.test(err), 'error')
    }
  }
})

// a proxy indicator that RepairDB is being called and doing its thing
makeTest('test repair() compacts', async function (db, t) {
  await db.close()

  let files = await fsp.readdir(db.location)
  t.ok(files.some(function (f) { return (/\.log$/).test(f) }), 'directory contains log file(s)')
  t.notOk(files.some(function (f) { return (/\.ldb$/).test(f) }), 'directory does not contain ldb file(s)')

  await ClassicLevel.repair(db.location)

  files = await fsp.readdir(db.location)
  t.notOk(files.some(function (f) { return (/\.log$/).test(f) }), 'directory does not contain log file(s)')
  t.ok(files.some(function (f) { return (/\.ldb$/).test(f) }), 'directory contains ldb file(s)')
})
