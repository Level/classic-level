'use strict'

const test = require('tape')
const testCommon = require('./common')

function makeTest (name, testFn) {
  test(name, async function (t) {
    const db = testCommon.factory()

    await db.open()
    await db.batch([
      { type: 'put', key: 'a', value: '1' },
      { type: 'put', key: 'b', value: '2' },
      { type: 'put', key: 'c', value: '3' }
    ])

    return testFn(db, t)
  })
}

module.exports = makeTest
