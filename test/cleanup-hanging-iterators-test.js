'use strict'

const makeTest = require('./make')
const repeats = 200

makeTest('test closed iterator', function (db, t, done) {
  // First test normal and proper usage: calling it.close() before db.close()
  const it = db.iterator()

  it.next(function (err, key, value) {
    t.ifError(err, 'no error from next()')
    t.equal(key, 'one', 'correct key')
    t.equal(value, '1', 'correct value')
    it.close(function (err) {
      t.ifError(err, 'no error from close()')
      done()
    })
  })
})

makeTest('test likely-closed iterator', function (db, t, done) {
  // Test improper usage: not calling it.close() before db.close(). Cleanup of the
  // database will crash Node if not handled properly.
  const it = db.iterator()

  it.next(function (err, key, value) {
    t.ifError(err, 'no error from next()')
    t.equal(key, 'one', 'correct key')
    t.equal(value, '1', 'correct value')
    done()
  })
})

makeTest('test non-closed iterator', function (db, t, done) {
  // Same as the test above but with a highWaterMarkBytes of 0 so that we don't
  // preemptively fetch all records, to ensure that the iterator is still
  // active when we (attempt to) close the database.
  const it = db.iterator({ highWaterMarkBytes: 0 })

  it.next(function (err, key, value) {
    t.ifError(err, 'no error from next()')
    t.equal(key, 'one', 'correct key')
    t.equal(value, '1', 'correct value')
    done()
  })
})

makeTest('test multiple likely-closed iterators', function (db, t, done) {
  // Same as the test above but repeated and with an extra iterator that is not
  // nexting, which means its EndWorker will be executed almost immediately.
  for (let i = 0; i < repeats; i++) {
    db.iterator()
    db.iterator().next(function () {})
  }

  setTimeout(done, Math.floor(Math.random() * 50))
})

makeTest('test multiple non-closed iterators', function (db, t, done) {
  // Same as the test above but with a highWaterMarkBytes of 0.
  for (let i = 0; i < repeats; i++) {
    db.iterator({ highWaterMarkBytes: 0 })
    db.iterator({ highWaterMarkBytes: 0 }).next(function () {})
  }

  setTimeout(done, Math.floor(Math.random() * 50))
})

global.gc && makeTest('test multiple non-closed iterators with forced gc', function (db, t, done) {
  // Same as the test above but with forced GC, to test that the lifespan of an
  // iterator is tied to *both* its JS object and whether the iterator was closed.
  for (let i = 0; i < repeats; i++) {
    db.iterator({ highWaterMarkBytes: 0 })
    db.iterator({ highWaterMarkBytes: 0 }).next(function () {})
  }

  setTimeout(function () {
    global.gc()
    done()
  }, Math.floor(Math.random() * 50))
})

makeTest('test closing iterators', function (db, t, done) {
  // At least one end() should be in progress when we try to close the db.
  const it1 = db.iterator()
  it1.next(function () {
    it1.close(function () {})
  })
  const it2 = db.iterator()
  it2.next(function () {
    it2.close(function () {})
    done()
  })
})

makeTest('test recursive next', function (db, t, done) {
  // Test that we're able to close when user keeps scheduling work
  const it = db.iterator({ highWaterMarkBytes: 0 })

  it.next(function loop (err, key) {
    if (err && err.code !== 'LEVEL_ITERATOR_NOT_OPEN') throw err
    if (key !== undefined) it.next(loop)
  })

  done()
})

makeTest('test recursive next (random)', function (db, t, done) {
  // Same as the test above but closing at a random time
  const it = db.iterator({ highWaterMarkBytes: 0 })

  it.next(function loop (err, key) {
    if (err && err.code !== 'LEVEL_ITERATOR_NOT_OPEN') throw err
    if (key !== undefined) it.next(loop)
  })

  setTimeout(done, Math.floor(Math.random() * 50))
})
