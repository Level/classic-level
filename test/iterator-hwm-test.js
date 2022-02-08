'use strict'

const test = require('tape')
const testCommon = require('./common')

let db

test('highWaterMarkBytes setup', async function (t) {
  db = testCommon.factory()

  // Write 8 bytes
  return db.batch().put('a', '0').put('b', '1').put('c', '2').put('d', '3').write()
})

test('highWaterMarkBytes limits byte length of nextv() entries', async function (t) {
  const hwm = async (highWaterMarkBytes) => {
    const it = db.iterator({ highWaterMarkBytes })
    const entries = await it.nextv(1e3)
    await it.close()
    return entries
  }

  t.same(await hwm(0), [['a', '0']], 'accepts 0')
  t.same(await hwm(Infinity), [['a', '0']], 'Infinity is interpreted as 0 (by Node-API)')
  t.same(await hwm(1), [['a', '0']], 'is limited')
  t.same(await hwm(2), [['a', '0'], ['b', '1']], 'highWaterMarkBytes must be exceeded, not met')
})

test('highWaterMarkBytes limits byte length of internal next() cache', async function (t) {
  const hwm = async (highWaterMarkBytes) => {
    const it = db.iterator({ highWaterMarkBytes })

    // Because initial next() calls don't cache, make two calls
    await it.next()
    await it.next()

    const count = 1 + it.cached
    await it.close()

    // Return how many bytes were retrieved natively by the second call
    return count * 2
  }

  t.is(await hwm(0), 2, 'accepts 0')
  t.is(await hwm(Infinity), 2, 'Infinity is interpreted as 0 (by Node-API)')
  t.is(await hwm(1), 2, 'is limited')
  t.is(await hwm(2), 4, 'highWaterMarkBytes must be exceeded, not met')
  t.is(await hwm(9), 6, 'double-check that previous test did apply a limit')
})

test('highWaterMarkBytes does not affect byte length of all() entries', async function (t) {
  const hwm = async (highWaterMarkBytes) => {
    // Note: setting hwm does make all() slower, as it uses nextv() atm
    return db.iterator({ highWaterMarkBytes }).all()
  }

  t.same(await hwm(0), [['a', '0'], ['b', '1'], ['c', '2'], ['d', '3']])
  t.same(await hwm(1), [['a', '0'], ['b', '1'], ['c', '2'], ['d', '3']])
})

test('highWaterMarkBytes teardown', async function (t) {
  return db.close()
})
