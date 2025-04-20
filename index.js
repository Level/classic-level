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
  #sharedBuffer = null

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
      getSync: true,
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
    let flags = 0

    if (options.fillCache !== false) flags |= FLAG_FILL_CACHE
    if (options.valueEncoding !== 'utf8') flags |= FLAG_VALUE_AS_BUFFER

    if (options.keyEncoding !== 'utf8') {
      flags |= FLAG_KEY_AS_BUFFER

      // If address of ArrayBuffer can move then copy it.
      // TODO: the spec says "Resizable ArrayBuffers are designed to be implementable with in-place
      // growth" (backed by virtual memory) so if V8 / Node.js implemented it that way, copying is
      // not necessary. Check if the address changes after a (significant) resize.
      if (key.buffer.resizable) {
        key = new Uint8Array(key)
      }
    }

    return binding.db_get(
      this[kContext],
      flags,
      key,
      options.snapshot?.[kContext]
    )
  }

  _getSync (key, options) {
    let flags = 0

    if (options.fillCache !== false) flags |= FLAG_FILL_CACHE
    if (options.valueEncoding !== 'utf8') flags |= FLAG_VALUE_AS_BUFFER

    if (options.keyEncoding !== 'utf8') {
      return binding.db_get_sync(
        this[kContext],
        flags,
        key,
        options.snapshot?.[kContext]
      )
    } else {
      let keySize

      // Write key to a reused buffer. This is slightly faster than
      // napi_get_value_string_utf8 but is mainly here as a starting
      // point for encodings that write into a buffer (WIP).
      if (this.#sharedBuffer === null) {
        keySize = this.#createSharedBuffer(key)
      } else {
        keySize = this.#sharedBuffer.write(key)

        // Resize if needed
        if (keySize === this.#sharedBuffer.byteLength) {
          keySize = this.#createSharedBuffer(key)
        }
      }

      return binding.db_get_sync(
        this[kContext],
        flags | FLAG_SHARED_KEY,
        keySize,
        options.snapshot?.[kContext]
      )
    }
  }

  #createSharedBuffer (str) {
    // Add at least 1 byte to detect when size is exceeded (without needing
    // to precompute size on every write) and more to avoid frequent resizing.
    this.#sharedBuffer = Buffer.allocUnsafe(Buffer.byteLength(str) + 64)

    // Save buffer on the database so that we can subsequently read from a
    // raw pointer instead of going through Node-API again.
    binding.db_set_shared_buffer(this[kContext], this.#sharedBuffer)

    return this.#sharedBuffer.write(str)
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

// Singular values are cheaper to transfer from JS to C++, so we
// combine options into flags.
const FLAG_FILL_CACHE = 1
const FLAG_KEY_AS_BUFFER = 2
const FLAG_VALUE_AS_BUFFER = 4
const FLAG_SHARED_KEY = 8
