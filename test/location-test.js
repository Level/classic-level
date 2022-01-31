'use strict'

const test = require('tape')
const { ClassicLevel } = require('..')

test('test database creation non-string location throws', function (t) {
  t.throws(() => new ClassicLevel({}), {
    name: 'TypeError',
    message: "The first argument 'location' must be a non-empty string"
  })
  t.throws(() => new ClassicLevel(''), {
    name: 'TypeError',
    message: "The first argument 'location' must be a non-empty string"
  })
  t.end()
})
