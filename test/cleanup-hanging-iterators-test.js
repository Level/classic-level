'use strict'

const makeTest = require('./make')
const repeats = 200

makeTest('closed iterator', async function (db, t) {
  // First test normal and proper usage: calling it.close() before db.close()
  const it = db.iterator()
  t.same(await it.next(), ['a', '1'], 'correct entry')
  await it.close()
  return db.close()
})

makeTest('likely-closed iterator', async function (db, t) {
  // Test improper usage: not calling it.close() before db.close(). Cleanup of the
  // database will crash Node if not handled properly.
  const it = db.iterator()

  // Two calls are needed to populate the cache
  t.same(await it.next(), ['a', '1'], 'correct entry (1)')
  t.same(await it.next(), ['b', '2'], 'correct entry (2)')

  return db.close()
})

makeTest('non-closed iterator', async function (db, t) {
  // Same as the test above but with a highWaterMarkBytes of 0 so that we don't
  // preemptively fetch all records, to ensure that the iterator is still
  // active when we (attempt to) close the database.
  const it = db.iterator({ highWaterMarkBytes: 0 })

  t.same(await it.next(), ['a', '1'], 'correct entry (1)')
  t.same(await it.next(), ['b', '2'], 'correct entry (2)')

  return db.close()
})

makeTest('non-closed iterator without caching', async function (db, t) {
  const it = db.iterator({ highWaterMarkBytes: 0 })
  t.same(await it.next(), ['a', '1'], 'correct entry (1)')
  return db.close()
})

makeTest('multiple likely-closed iterators', async function (db, t) {
  // Same as the test above but repeated and with an extra iterator that is not
  // nexting, which means its CloseWorker will be executed almost immediately.
  for (let i = 0; i < repeats; i++) {
    db.iterator()
    db.iterator().next()
  }

  // Avoid async/await to avoid introducing an extra tick
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      db.close().then(resolve, reject)
    }, Math.floor(Math.random() * 50))
  })
})

makeTest('multiple non-closed iterators', async function (db, t) {
  // Same as the test above but with a highWaterMarkBytes of 0.
  for (let i = 0; i < repeats; i++) {
    db.iterator({ highWaterMarkBytes: 0 })
    db.iterator({ highWaterMarkBytes: 0 }).next()
  }

  // Avoid async/await to avoid introducing an extra tick
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      db.close().then(resolve, reject)
    }, Math.floor(Math.random() * 50))
  })
})

global.gc && makeTest('multiple non-closed iterators with forced gc', async function (db, t) {
  // Same as the test above but with forced GC, to test that the lifespan of an
  // iterator is tied to *both* its JS object and whether the iterator was closed.
  for (let i = 0; i < repeats; i++) {
    db.iterator({ highWaterMarkBytes: 0 })
    db.iterator({ highWaterMarkBytes: 0 }).next()
  }

  // Avoid async/await to avoid introducing an extra tick
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      global.gc()
      db.close().then(resolve, reject)
    }, Math.floor(Math.random() * 50))
  })
})

makeTest('closing iterators', async function (db, t) {
  return new Promise((resolve, reject) => {
    // At least one close() should be in progress when we try to close the db.
    const it1 = db.iterator()
    it1.next().then(function () {
      it1.close()
    })

    const it2 = db.iterator()
    it2.next().then(function () {
      it2.close()
      db.close().then(resolve, reject)
    })
  })
})

makeTest('recursive next', async function (db, t) {
  // Test that we're able to close when user keeps scheduling work
  const it = db.iterator({ highWaterMarkBytes: 0 })

  function resolve (entry) {
    if (entry !== undefined) it.next().then(resolve, reject)
  }

  function reject (err) {
    if (err.code !== 'LEVEL_ITERATOR_NOT_OPEN') throw err
  }

  it.next().then(resolve, reject)
  return db.close()
})

makeTest('recursive next (random)', async function (db, t) {
  // Same as the test above but closing at a random time
  const it = db.iterator({ highWaterMarkBytes: 0 })

  function resolve (entry) {
    if (entry !== undefined) it.next().then(resolve, reject)
  }

  function reject (err) {
    if (err.code !== 'LEVEL_ITERATOR_NOT_OPEN') throw err
  }

  it.next().then(resolve, reject)

  // Avoid async/await to avoid introducing an extra tick
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      db.close().then(resolve, reject)
    }, Math.floor(Math.random() * 50))
  })
})
