'use strict'

const { AbstractChainedBatch } = require('abstract-level')
const binding = require('./binding')

const kContext = Symbol('context')

class ChainedBatch extends AbstractChainedBatch {
  constructor (db, context) {
    super(db)
    this[kContext] = binding.batch_init(context)
  }
}

// TODO: move to class

ChainedBatch.prototype._put = function (key, value) {
  binding.batch_put(this[kContext], key, value)
}

ChainedBatch.prototype._del = function (key) {
  binding.batch_del(this[kContext], key)
}

ChainedBatch.prototype._clear = function () {
  binding.batch_clear(this[kContext])
}

ChainedBatch.prototype._write = function (options, callback) {
  binding.batch_write(this[kContext], options, callback)
}

ChainedBatch.prototype._close = function (callback) {
  // TODO: close native batch (currently done on GC)
  process.nextTick(callback)
}

exports.ChainedBatch = ChainedBatch
