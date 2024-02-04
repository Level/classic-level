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

// TODO: move to abstract-level
for (const slice of [false, true]) {
  test(`nextv() after next() respects cache (slice=${slice})`, async function (t) {
    const db = testCommon.factory()

    await db.open()
    await db.batch()
      .put('a', 'value')
      .put('b', 'value')
      .put('c', 'value')
      .put('d', 'value')
      .write()

    const it = db.iterator()

    // Two calls are needed to populate the cache
    t.same(await it.next(), ['a', 'value'], 'entry a ok')
    t.same(await it.next(), ['b', 'value'], 'entry b ok')
    t.is(it.cached, 2)

    if (slice) {
      t.same(await it.nextv(1), [['c', 'value']], 'entries ok (1)')
      t.same(await it.nextv(1), [['d', 'value']], 'entries ok (2)')
      t.same(await it.nextv(1), [], 'empty')
    } else {
      t.same(await it.nextv(10), [['c', 'value'], ['d', 'value']], 'entries ok')
      t.same(await it.nextv(10), [], 'empty')
    }

    await it.close()
    return db.close()
  })
}
