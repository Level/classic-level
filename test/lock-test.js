'use strict'

const test = require('tape')
const tempy = require('tempy')
const fork = require('child_process').fork
const path = require('path')
const { ClassicLevel } = require('..')

test('lock held by same process', async function (t) {
  t.plan(2)

  const location = tempy.directory()
  const db1 = new ClassicLevel(location)
  await db1.open()
  const db2 = new ClassicLevel(location)

  try {
    await db2.open()
  } catch (err) {
    t.is(err.code, 'LEVEL_DATABASE_NOT_OPEN', 'second instance failed to open')
    t.is(
      err.cause.message,
      'Invalid argument: Database already opened. Must set multithreading flag to true for all instances',
      'second instance got lock error'
    )
  }

  return db1.close()
})

test('lock held by other process', function (t) {
  t.plan(6)

  const location = tempy.directory()
  const db = new ClassicLevel(location)

  db.open(function (err) {
    t.ifError(err, 'no open error')

    const child = fork(path.join(__dirname, 'lock.js'), [location])

    child.on('message', function (err) {
      t.is(err.code, 'LEVEL_DATABASE_NOT_OPEN', 'second process failed to open')
      t.is(err.cause.code, 'LEVEL_LOCKED', 'second process got lock error')

      child.disconnect()
    })

    child.on('exit', function (code, sig) {
      t.is(code, 0, 'child exited normally')
      t.is(sig, null, 'not terminated due to signal')

      db.close(t.ifError.bind(t))
    })
  })
})
