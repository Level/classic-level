'use strict'

const test = require('tape')
const testCommon = require('./common')

test('iterator optimized for seek', async function (t) {
  const db = testCommon.factory()

  await db.open()
  await db.batch()
    .put('a', 'value')
    .put('b', 'value')
    .put('c', 'value')
    .put('d', 'value')
    .put('e', 'value')
    .put('f', 'value')
    .put('g', 'value')
    .write()

  const ite = db.iterator()

  t.same(await ite.next(), ['a', 'value'], 'entry matches')
  t.is(ite.cached, 0, 'no cache')

  t.same(await ite.next(), ['b', 'value'], 'entry matches')
  t.ok(ite.cached > 0, 'has cached items')

  ite.seek('d')
  t.is(ite.cached, 0, 'cache is emptied')

  t.same(await ite.next(), ['d', 'value'], 'entry matches')
  t.is(ite.cached, 0, 'no cache')

  t.same(await ite.next(), ['e', 'value'], 'entry matches')
  t.ok(ite.cached > 0, 'has cached items')

  await ite.close()
  return db.close()
})
