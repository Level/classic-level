'use strict'

const { AbstractIterator } = require('abstract-level')
const binding = require('./binding')

const kContext = Symbol('context')
const kCache = Symbol('cache')
const kFirst = Symbol('first')
const kPosition = Symbol('position')
const kState = Symbol('state')
const kSignal = Symbol('signal')
const kAbort = Symbol('abort')
const empty = []

// Bit fields
const STATE_ENDED = 1

// Does not implement _all() because the default implementation
// of abstract-level falls back to nextv(1000) and using all()
// on more entries than that probably isn't a realistic use case,
// so it'll typically just make one nextv(1000) call and there's
// no performance gain in overriding _all().
class Iterator extends AbstractIterator {
  constructor (db, context, options) {
    super(db, options)

    this[kState] = new Uint8Array(1)
    this[kContext] = binding.iterator_init(context, this[kState], options)
    this[kFirst] = true
    this[kCache] = empty
    this[kPosition] = 0
  }

  _seek (target, options) {
    this[kFirst] = true
    this[kCache] = empty
    this[kState][0] &= ~STATE_ENDED // Unset
    this[kPosition] = 0

    binding.iterator_seek(this[kContext], target)
  }

  async _next () {
    if (this[kPosition] < this[kCache].length) {
      return this[kCache][this[kPosition]++]
    }

    // Avoid iterator_nextv() call if end was already reached
    if ((this[kState][0] & STATE_ENDED) !== 0) {
      return undefined
    }

    if (this[kFirst]) {
      // It's common to only want one entry initially or after a seek()
      this[kFirst] = false
      this[kCache] = await binding.iterator_nextv(this[kContext], 1)
      this[kPosition] = 0
    } else {
      // Limit the size of the cache to prevent starving the event loop
      // while we're recursively nexting.
      this[kCache] = await binding.iterator_nextv(this[kContext], 1000)
      this[kPosition] = 0
    }

    if (this[kPosition] < this[kCache].length) {
      return this[kCache][this[kPosition]++]
    }
  }

  // TODO (v2): read from cache first?
  async _nextv (size, options) {
    this[kFirst] = false

    // Avoid iterator_nextv() call if end was already reached
    if ((this[kState][0] & STATE_ENDED) !== 0) {
      return []
    }

    return binding.iterator_nextv(this[kContext], size)
  }

  async _close () {
    this[kCache] = empty
    return binding.iterator_close(this[kContext])
  }

  // Undocumented, exposed for tests only
  get cached () {
    return this[kCache].length - this[kPosition]
  }
}

exports.Iterator = Iterator
