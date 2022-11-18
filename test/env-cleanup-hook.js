'use strict'

const testCommon = require('./common')
const noop = () => {}

async function test (steps) {
  let step

  function nextStep () {
    step = steps.shift() || step
    return step
  }

  if (nextStep() !== 'create') {
    // Send a message triggering an environment exit
    // and indicating at which step we stopped.
    process.send(step)
    return
  }

  const db = testCommon.factory()

  if (nextStep() !== 'open') {
    if (nextStep() === 'open-error') {
      // If opening fails the cleanup hook should be a noop.
      db.open({ createIfMissing: false, errorIfExists: true }).then(function () {
        throw new Error('Expected an open() error')
      }, noop)
    }

    return process.send(step)
  }

  // Open the db, expected to be closed by the cleanup hook.
  await db.open()

  if (nextStep() === 'create-iterator') {
    // Create an iterator, expected to be closed by the cleanup hook.
    const it = db.iterator()

    if (nextStep() === 'nexting') {
      // This async work should finish before the cleanup hook is called.
      it.next()
    }
  }

  if (nextStep() === 'close') {
    // Close the db, after which the cleanup hook is a noop.
    db.close()
  }

  process.send(step)
}

test(process.argv.slice(2))
