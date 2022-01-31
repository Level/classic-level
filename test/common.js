'use strict'

const test = require('tape')
const tempy = require('tempy')
const { ClassicLevel } = require('..')
const suite = require('abstract-level/test')

module.exports = suite.common({
  test,
  factory (options) {
    return new ClassicLevel(tempy.directory(), options)
  }
})
