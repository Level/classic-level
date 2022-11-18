'use strict'

const { ClassicLevel } = require('..')

const location = process.argv[2]
const db = new ClassicLevel(location)

db.open().then(function () {
  process.send(null)
}, function (err) {
  process.send(err)
})
