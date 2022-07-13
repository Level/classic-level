'use strict'

const { AbstractIterator } = require('abstract-level')
const binding = require('./binding')

const kContext = Symbol('context')
const kPool = Symbol('pool')
const kLengths = Symbol('lengths')
const kOffset = Symbol('offset')
const kAsEntry = Symbol('asEntry')
const kFinished = Symbol('finished')
const kFirst = Symbol('first')
const kPosition = Symbol('position')
const kHandleNext = Symbol('handleNext')
const kHandleNextv = Symbol('handleNextv')
const kCallback = Symbol('callback')
const empty = []
const emptyBuffer = Buffer.alloc(0)

// Does not implement _all() because the default implementation
// of abstract-level falls back to nextv(1000) and using all()
// on more entries than that probably isn't a realistic use case,
// so it'll typically just make one nextv(1000) call and there's
// no performance gain in overriding _all().
class Iterator extends AbstractIterator {
  constructor (db, context, options) {
    super(db, options)

    this[kContext] = binding.iterator_init(context, options)
    this[kAsEntry] = options.keys && options.values
    this[kHandleNext] = this[kHandleNext].bind(this)
    this[kHandleNextv] = this[kHandleNextv].bind(this)
    this[kCallback] = null
    this[kFirst] = true
    this[kPool] = null
    this[kLengths] = empty
    this[kOffset] = 0
    this[kFinished] = false
    this[kPosition] = 0
  }

  _seek (target, options) {
    this[kFirst] = true
    this[kPool] = null
    this[kLengths] = empty
    this[kOffset] = 0
    this[kFinished] = false
    this[kPosition] = 0

    binding.iterator_seek(this[kContext], target)
  }

  _next (callback) {
    if (this[kPosition] < this[kLengths].length) {
      const [keyLength, valueLength] = this[kLengths][this[kPosition]++]
      const key = Buffer.from(this[kPool], this[kOffset], keyLength)
      this[kOffset] += keyLength
      const value = Buffer.from(this[kPool], this[kOffset], valueLength)
      this[kOffset] += valueLength
      process.nextTick(callback, null, key, value)
    } else if (this[kFinished]) {
      process.nextTick(callback)
    } else {
      this[kCallback] = callback

      if (this[kFirst]) {
        // It's common to only want one entry initially or after a seek()
        this[kFirst] = false
        binding.iterator_nextv(this[kContext], 1, this[kHandleNext])
      } else {
        // Limit the size of the cache to prevent starving the event loop
        // while we're recursively calling process.nextTick().
        binding.iterator_nextv(this[kContext], 1000, this[kHandleNext])
      }
    }
  }

  [kHandleNext] (err, pool, lengths, finished) {
    const callback = this[kCallback]
    if (err) return callback(err)

    this[kPool] = pool
    this[kLengths] = lengths
    this[kOffset] = 0
    this[kFinished] = finished
    this[kPosition] = 0

    this._next(callback)
  }

  _nextv (size, options, callback) {
    if (this[kFinished]) {
      process.nextTick(callback, null, [])
    } else {
      this[kCallback] = callback
      this[kFirst] = false
      binding.iterator_nextv(this[kContext], size, this[kHandleNextv])
    }
  }

  [kHandleNextv] (err, pool, lengths, finished) {
    const callback = this[kCallback]
    if (err) return callback(err)
    this[kFinished] = finished

    let offset = 0
    const toBuffer = (length) => {
      if (length === 0) return emptyBuffer
      const buf = Buffer.from(pool, offset, length)
      offset += length
      return buf
    }

    callback(null, lengths.map(lengths => lengths.map(toBuffer)))

    // if (this[kAsEntry]) {
    //   callback(null, lengths.map(lengths => lengths.map(toBuffer)))
    // } else {
    //   callback(null, lengths.map(toBuffer))
    // }
  }

  _close (callback) {
    this[kPool] = null
    this[kCallback] = null

    binding.iterator_close(this[kContext], callback)
  }

  // Undocumented, exposed for tests only
  get cached () {
    return this[kLengths].length - this[kPosition]
  }
}

exports.Iterator = Iterator
