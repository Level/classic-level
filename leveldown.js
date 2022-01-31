'use strict'

// TODO: rename file

const { AbstractLevel } = require('abstract-level')
const ModuleError = require('module-error')
const { fromCallback } = require('catering')
const binding = require('./binding')
const { ChainedBatch } = require('./chained-batch')
const { Iterator } = require('./iterator')

const kPromise = Symbol('promise')
const kContext = Symbol('context')
const kLocation = Symbol('location')

class ClassicLevel extends AbstractLevel {
  constructor (location, options, _) {
    // To help migrating to abstract-level
    if (typeof options === 'function' || typeof _ === 'function') {
      throw new ModuleError('The levelup-style callback argument has been removed', {
        code: 'LEVEL_LEGACY'
      })
    }

    if (typeof location !== 'string' || location === '') {
      throw new TypeError("The first argument 'location' must be a non-empty string")
    }

    super({
      encodings: {
        buffer: true,
        utf8: true
      },
      seek: true,
      createIfMissing: true,
      errorIfExists: true,
      additionalMethods: {
        approximateSize: true,
        compactRange: true
      }
    }, options)

    this[kLocation] = location
    this[kContext] = binding.db_init()
  }

  get location () {
    return this[kLocation]
  }
}

// TODO: move to class

ClassicLevel.prototype._open = function (options, callback) {
  binding.db_open(this[kContext], this[kLocation], options, callback)
}

ClassicLevel.prototype._close = function (callback) {
  binding.db_close(this[kContext], callback)
}

ClassicLevel.prototype._put = function (key, value, options, callback) {
  binding.db_put(this[kContext], key, value, options, callback)
}

ClassicLevel.prototype._get = function (key, options, callback) {
  binding.db_get(this[kContext], key, options, callback)
}

ClassicLevel.prototype._getMany = function (keys, options, callback) {
  binding.db_get_many(this[kContext], keys, options, callback)
}

ClassicLevel.prototype._del = function (key, options, callback) {
  binding.db_del(this[kContext], key, options, callback)
}

ClassicLevel.prototype._clear = function (options, callback) {
  binding.db_clear(this[kContext], options, callback)
}

ClassicLevel.prototype._chainedBatch = function () {
  return new ChainedBatch(this, this[kContext])
}

ClassicLevel.prototype._batch = function (operations, options, callback) {
  binding.batch_do(this[kContext], operations, options, callback)
}

ClassicLevel.prototype.approximateSize = function (start, end, options, callback) {
  if (arguments.length < 2 || typeof start === 'function' || typeof end === 'function') {
    throw new TypeError("The arguments 'start' and 'end' are required")
  } else if (typeof options === 'function') {
    callback = options
    options = null
  } else if (typeof options !== 'object') {
    options = null
  }

  callback = fromCallback(callback, kPromise)

  if (this.status === 'opening') {
    this.defer(() => this.approximateSize(start, end, options, callback))
  } else if (this.status !== 'open') {
    this.nextTick(callback, new ModuleError('Database is not open: cannot call approximateSize()', {
      code: 'LEVEL_DATABASE_NOT_OPEN'
    }))
  } else {
    const keyEncoding = this.keyEncoding(options && options.keyEncoding)
    start = keyEncoding.encode(start)
    end = keyEncoding.encode(end)
    binding.db_approximate_size(this[kContext], start, end, callback)
  }

  return callback[kPromise]
}

ClassicLevel.prototype.compactRange = function (start, end, options, callback) {
  if (arguments.length < 2 || typeof start === 'function' || typeof end === 'function') {
    throw new TypeError("The arguments 'start' and 'end' are required")
  } else if (typeof options === 'function') {
    callback = options
    options = null
  } else if (typeof options !== 'object') {
    options = null
  }

  callback = fromCallback(callback, kPromise)

  if (this.status === 'opening') {
    this.defer(() => this.compactRange(start, end, options, callback))
  } else if (this.status !== 'open') {
    this.nextTick(callback, new ModuleError('Database is not open: cannot call compactRange()', {
      code: 'LEVEL_DATABASE_NOT_OPEN'
    }))
  } else {
    const keyEncoding = this.keyEncoding(options && options.keyEncoding)
    start = keyEncoding.encode(start)
    end = keyEncoding.encode(end)
    binding.db_compact_range(this[kContext], start, end, callback)
  }

  return callback[kPromise]
}

ClassicLevel.prototype.getProperty = function (property) {
  if (typeof property !== 'string') {
    throw new TypeError("The first argument 'property' must be a string")
  }

  // Is synchronous, so can't be deferred
  if (this.status !== 'open') {
    throw new ModuleError('Database is not open', {
      code: 'LEVEL_DATABASE_NOT_OPEN'
    })
  }

  return binding.db_get_property(this[kContext], property)
}

ClassicLevel.prototype._iterator = function (options) {
  return new Iterator(this, this[kContext], options)
}

ClassicLevel.destroy = function (location, callback) {
  if (typeof location !== 'string' || location === '') {
    throw new TypeError("The first argument 'location' must be a non-empty string")
  }

  callback = fromCallback(callback, kPromise)
  binding.destroy_db(location, callback)
  return callback[kPromise]
}

ClassicLevel.repair = function (location, callback) {
  if (typeof location !== 'string' || location === '') {
    throw new TypeError("The first argument 'location' must be a non-empty string")
  }

  callback = fromCallback(callback, kPromise)
  binding.repair_db(location, callback)
  return callback[kPromise]
}

exports.ClassicLevel = ClassicLevel
