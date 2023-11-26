'use strict'

const test = require('tape')
const tempy = require('tempy')
const path = require('path')
const { Worker } = require('worker_threads')
const { ClassicLevel } = require('..')
const {
  MIN_KEY,
  MID_KEY,
  MAX_KEY,
  CLOSED_DB_MESSAGE,
  WORKER_CREATING_KEYS_MESSAGE,
  WORKER_READY_TO_READ_MESSAGE,
  WORKER_ERROR_MESSAGE,
  START_READING_MESSAGE,
  createRandomKeys,
  getRandomKeys
} = require('./worker-utils')

/**
 * Makes sure that the multithreading flag is working as expected
 */
test('check multithreading flag works as expected', async function (t) {
  t.plan(9)
  const location = tempy.directory()
  const db1 = new ClassicLevel(location)
  const db2 = new ClassicLevel(location)

  // check that must set multithreading flag on all instances
  await db1.open()
  t.is(db1.location, location)
  try {
    await db2.open({ multithreading: true })
  } catch (err) {
    t.is(err.code, 'LEVEL_DATABASE_NOT_OPEN', 'second instance failed to open')
    t.is(err.cause.code, 'LEVEL_LOCKED', 'second instance got lock error')
  }
  await db1.close()

  await db1.open({ multithreading: true })
  t.is(db1.location, location)
  await db2.open({ multithreading: true })
  t.is(db2.location, location)
  // test that passing to the constructor works
  const db3 = new ClassicLevel(location, { multithreading: true })
  await db3.open()
  t.is(db3.location, location)
  const db4 = new ClassicLevel(location)
  try {
    await db4.open({ location, multithreading: false })
  } catch (err) {
    t.is(err.code, 'LEVEL_DATABASE_NOT_OPEN', 'fourth instance failed to open')
    t.is(err.cause.code, 'LEVEL_LOCKED', 'second instance got lock error')
  }
  await db1.close()
  await db2.close()
  await db3.close()

  const db5 = new ClassicLevel(location)
  await db5.open({ location, multithreading: false })
  t.is(db5.location, location)
  await db5.close()
})

/**
 * Tests for interleaved opening and closing of the database to check
 * that the mutex for guarding the handles is working as expected.  Creates
 * many workers that only open and then close the db after a random delay.  Goal
 * is to interleave the open and close processes to ensure that the mutex is
 * guarding the handles correctly.  After all workers have completed the main
 * thread closes the db and then opens it again as a non-multi-threaded instance
 * to make sure the handle was deleted correctly.
 */
test('open/close mutex works as expected', async function (t) {
  t.plan(3)
  const location = tempy.directory()
  const db1 = new ClassicLevel(location)
  await db1.open({ multithreading: true })
  t.is(db1.location, location)

  const activeWorkers = []

  for (let i = 0; i < 100; i++) {
    const worker = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: { location, workerStartup: true }
    })

    activeWorkers.push(
      new Promise((resolve, reject) => {
        worker.once('message', ({ message, error }) => {
          if (message === WORKER_ERROR_MESSAGE) {
            return reject(error)
          }
          if (message === CLOSED_DB_MESSAGE) {
            return resolve()
          }
          return reject(new Error('unexpected error\n>>> ' + error))
        })
      })
    )
  }

  const results = await Promise.allSettled(activeWorkers)
  const rejected = results.filter((res) => res.status === 'rejected')
  t.is(rejected.length, 0)
  await db1.close()

  // reopen the db non-multithreaded to check that the handle record was fully
  // deleted from the handle map
  await db1.open({ multithreading: false })
  t.is(db1.location, location)
  await db1.close()
})

/**
 * Tests for reading and writing to a single db from multiple threads.
 *
 * Starts by setting up worker and then worker reports its ready and immediately
 * starts writing to the database.  Main thread gets message and also writes to
 * the same db but to a different key space.  Goal is to concurrently write
 * consecutively numbered records.  Once records are all written the worker
 * reports to the main thread and the main thread waits until both threads are
 * complete with the writing process. When both are ready they concurrently read
 * random records from the full key space for a set interval.
 */
test('allow multi-threading by same process', async function (t) {
  try {
    const location = tempy.directory()
    const db = new ClassicLevel(location, { multithreading: true })
    await db.open()

    const worker = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: { location, readWrite: true }
    })

    function cleanup (err) {
      worker.removeAllListeners('message')
      worker.removeAllListeners('error')
      worker.terminate()
      if (err) {
        throw err
      }
    }

    worker.on('error', cleanup)
    worker.on('message', ({ message, error }) => {
      if (message === WORKER_ERROR_MESSAGE) {
        cleanup(new Error(error))
      }
    })

    // Concurrently write keys to the db on both thread and wait
    // until ready before attempting to concurrently read keys
    const workerReady = new Promise((resolve) => {
      let mainThreadReady = false
      worker.on('message', ({ message }) => {
        if (message === WORKER_CREATING_KEYS_MESSAGE) {
          createRandomKeys(db, MID_KEY, MAX_KEY).then(() => {
            mainThreadReady = true
          })
        } else if (message === WORKER_READY_TO_READ_MESSAGE) {
          const interval = setInterval(() => {
            if (mainThreadReady) {
              clearInterval(interval)
              resolve()
            }
          }, 100)
        }
      })
    })

    await workerReady

    // once db is seeded start reading keys from both threads
    worker.postMessage({ message: START_READING_MESSAGE })
    await getRandomKeys(db, MIN_KEY, MAX_KEY)
    await db.close()

    t.end()
  } catch (error) {
    t.fail(error.message)
    t.end()
  }
})
