'use strict'

const { AbstractChainedBatch } = require('abstract-level')
const binding = require('./binding')

const kContext = Symbol('context')

class ChainedBatch extends AbstractChainedBatch {
  constructor (db, context) {
    super(db)
    this[kContext] = binding.batch_init(context)
  }

  _put (key, value) {
    binding.batch_put(this[kContext], key, value)
  }

  _del (key) {
    binding.batch_del(this[kContext], key)
  }

  _clear () {
    binding.batch_clear(this[kContext])
  }

  async _write (options) {
    return binding.batch_write(this[kContext], options)
  }

  async _close () {
    // TODO: close native batch (currently done on GC)
  }
}

exports.ChainedBatch = ChainedBatch
