'use strict'

const make = require('./make')

make('iterator optimized for seek', function (db, t, done) {
  const batch = db.batch()
  batch.put('a', 1)
  batch.put('b', 1)
  batch.put('c', 1)
  batch.put('d', 1)
  batch.put('e', 1)
  batch.put('f', 1)
  batch.put('g', 1)
  batch.write(function (err) {
    const ite = db.iterator()
    t.ifError(err, 'no error from batch()')
    ite.next(function (err, key, value) {
      t.ifError(err, 'no error from next()')
      t.equal(key.toString(), 'a', 'key matches')
      t.equal(ite.cached, 0, 'no cache')
      ite.next(function (err, key, value) {
        t.ifError(err, 'no error from next()')
        t.equal(key.toString(), 'b', 'key matches')
        t.ok(ite.cached > 0, 'has cached items')
        ite.seek('d')
        t.is(ite.cached, 0, 'cache is emptied')
        ite.next(function (err, key, value) {
          t.ifError(err, 'no error from next()')
          t.equal(key.toString(), 'd', 'key matches')
          t.equal(ite.cached, 0, 'no cache')
          ite.next(function (err, key, value) {
            t.ifError(err, 'no error from next()')
            t.equal(key.toString(), 'e', 'key matches')
            t.ok(ite.cached > 0, 'has cached items')
            ite.close(done)
          })
        })
      })
    })
  })
})

make('iterator flatten', function (db, t, done) {
  const batch = db.batch()
  batch.put('a', 1)
  batch.put('b', 1)
  batch.write(function (err) {
    t.ifError(err, 'no error from batch()')
    const ite = db.iterator({ flatten: true }).all((err, arr) => {
      t.ifError(err, 'no error from iterator')
      t.same(arr, ['a', 1, 'b', 1])
      done()
    })
  })
})
