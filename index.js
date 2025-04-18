'use strict'

const { AbstractLevel, AbstractSnapshot } = require('abstract-level')
const ModuleError = require('module-error')
const fsp = require('fs/promises')
const binding = require('./binding')
const { ChainedBatch } = require('./chained-batch')
const { Iterator } = require('./iterator')

const kContext = Symbol('context')
const kLocation = Symbol('location')

class ClassicLevel extends AbstractLevel {
  constructor (location, options) {
    if (typeof location !== 'string' || location === '') {
      throw new TypeError("The first argument 'location' must be a non-empty string")
    }

    super({
      encodings: {
        buffer: true,
        utf8: true,
        view: true
      },
      has: true,
      createIfMissing: true,
      errorIfExists: true,
      explicitSnapshots: true,
      additionalMethods: {
        approximateSize: true,
        compactRange: true
      },
      signals: {
        iterators: true
      }
    }, options)

    this[kLocation] = location
    this[kContext] = binding.db_init()
  }

  get location () {
    return this[kLocation]
  }

  async _open (options) {
    if (options.createIfMissing) {
      await fsp.mkdir(this[kLocation], { recursive: true })
    }

    return binding.db_open(this[kContext], this[kLocation], options)
  }

  async _close () {
    return binding.db_close(this[kContext])
  }

  async _put (key, value, options) {
    return binding.db_put(this[kContext], key, value, options)
  }

  async _get (key, options) {
    return binding.db_get(
      this[kContext],
      key,
      encodingEnum(options.valueEncoding),
      options.fillCache,
      options.snapshot?.[kContext]
    )
  }

  async _getMany (keys, options) {
    return binding.db_get_many(
      this[kContext],
      keys,
      options,
      options.snapshot?.[kContext]
    )
  }

  async _has (key, options) {
    return binding.db_has(
      this[kContext],
      key,
      options.fillCache,
      options.snapshot?.[kContext]
    )
  }

  async _hasMany (keys, options) {
    // Use a space-efficient bitset (with 32-bit words) to contain found keys
    const wordCount = (keys.length + 32) >>> 5
    const buffer = new ArrayBuffer(wordCount * 4)
    const bitset = new Uint32Array(buffer)

    await binding.db_has_many(
      this[kContext],
      keys,
      options.fillCache,
      options.snapshot?.[kContext],
      buffer
    )

    const values = new Array(keys.length)

    for (let i = 0; i < values.length; i++) {
      // Check if bit is set
      values[i] = (bitset[i >>> 5] & (1 << (i & 31))) !== 0
    }

    return values
  }

  async _del (key, options) {
    return binding.db_del(this[kContext], key, options)
  }

  async _clear (options) {
    return binding.db_clear(
      this[kContext],
      options,
      options.snapshot?.[kContext]
    )
  }

  _chainedBatch () {
    return new ChainedBatch(this, this[kContext])
  }

  async _batch (operations, options) {
    return binding.batch_do(this[kContext], operations, options)
  }

  async approximateSize (start, end, options) {
    if (arguments.length < 2) {
      throw new TypeError("The arguments 'start' and 'end' are required")
    } else if (typeof options !== 'object') {
      options = null
    }

    if (this.status === 'opening') {
      return this.deferAsync(() => this.approximateSize(start, end, options))
    } else if (this.status !== 'open') {
      throw new ModuleError('Database is not open: cannot call approximateSize()', {
        code: 'LEVEL_DATABASE_NOT_OPEN'
      })
    } else {
      const keyEncoding = this.keyEncoding(options && options.keyEncoding)
      start = keyEncoding.encode(start)
      end = keyEncoding.encode(end)
      return binding.db_approximate_size(this[kContext], start, end)
    }
  }

  async compactRange (start, end, options) {
    if (arguments.length < 2) {
      throw new TypeError("The arguments 'start' and 'end' are required")
    } else if (typeof options !== 'object') {
      options = null
    }

    if (this.status === 'opening') {
      return this.deferAsync(() => this.compactRange(start, end, options))
    } else if (this.status !== 'open') {
      throw new ModuleError('Database is not open: cannot call compactRange()', {
        code: 'LEVEL_DATABASE_NOT_OPEN'
      })
    } else {
      const keyEncoding = this.keyEncoding(options && options.keyEncoding)
      start = keyEncoding.encode(start)
      end = keyEncoding.encode(end)
      return binding.db_compact_range(this[kContext], start, end)
    }
  }

  getProperty (property) {
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

  _iterator (options) {
    return new Iterator(
      this,
      this[kContext],
      options,
      options.snapshot?.[kContext]
    )
  }

  _snapshot (options) {
    return new Snapshot(this[kContext], options)
  }

  static async destroy (location) {
    if (typeof location !== 'string' || location === '') {
      throw new TypeError("The first argument 'location' must be a non-empty string")
    }

    return binding.destroy_db(location)
  }

  static async repair (location) {
    if (typeof location !== 'string' || location === '') {
      throw new TypeError("The first argument 'location' must be a non-empty string")
    }

    return binding.repair_db(location)
  }
}

// Defined here so that both ClassicLevel and Snapshot can access kContext
class Snapshot extends AbstractSnapshot {
  constructor (context, options) {
    super(options)
    this[kContext] = binding.snapshot_init(context)
  }

  async _close () {
    // This is synchronous because that's faster than creating async work
    binding.snapshot_close(this[kContext])
  }
}

exports.ClassicLevel = ClassicLevel

// It's faster to read options in JS than to pass options objects to C++.
const encodingEnum = function (encoding) {
  if (encoding === 'buffer') return 0
  if (encoding === 'utf8') return 1

  /* istanbul ignore else: should not happen */
  if (encoding === 'view') return 2
}
