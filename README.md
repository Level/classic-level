# classic-level

**An [`abstract-level`](https://github.com/Level/abstract-level) database backed by [LevelDB](https://github.com/google/leveldb).** The successor to [`leveldown`](https://github.com/Level/leveldown) with builtin encodings, sublevels, events, hooks and support of Uint8Array. If you are upgrading, please see [`UPGRADING.md`](UPGRADING.md).

> :pushpin: What is `abstract-level`? Head on over to [Frequently Asked Questions](https://github.com/Level/community#faq).

[![level badge][level-badge]](https://github.com/Level/awesome)
[![npm](https://img.shields.io/npm/v/classic-level.svg)](https://www.npmjs.com/package/classic-level)
[![Node version](https://img.shields.io/node/v/classic-level.svg)](https://www.npmjs.com/package/classic-level)
[![Test](https://img.shields.io/github/actions/workflow/status/Level/classic-level/test.yml?branch=main\&label=test)](https://github.com/Level/classic-level/actions/workflows/test.yml)
[![Coverage](https://img.shields.io/codecov/c/github/Level/classic-level?label=\&logo=codecov\&logoColor=fff)](https://codecov.io/gh/Level/classic-level)
[![Standard](https://img.shields.io/badge/standard-informational?logo=javascript\&logoColor=fff)](https://standardjs.com)
[![Common Changelog](https://common-changelog.org/badge.svg)](https://common-changelog.org)
[![Donate](https://img.shields.io/badge/donate-orange?logo=open-collective\&logoColor=fff)](https://opencollective.com/level)

## Usage

```js
const { ClassicLevel } = require('classic-level')

// Create a database
const db = new ClassicLevel('./db', { valueEncoding: 'json' })

// Add an entry with key 'a' and value 1
await db.put('a', 1)

// Add multiple entries
await db.batch([{ type: 'put', key: 'b', value: 2 }])

// Get value of key 'a': 1
const value = await db.get('a')

// Iterate entries with keys that are greater than 'a'
for await (const [key, value] of db.iterator({ gt: 'a' })) {
  console.log(value) // 2
}
```

Usage from TypeScript requires generic type parameters.

<details><summary>TypeScript example</summary>

```ts
// Specify types of keys and values (any, in the case of json).
// The generic type parameters default to ClassicLevel<string, string>.
const db = new ClassicLevel<string, any>('./db', { valueEncoding: 'json' })

// All relevant methods then use those types
await db.put('a', { x: 123 })

// Specify different types when overriding encoding per operation
await db.get<string, string>('a', { valueEncoding: 'utf8' })

// Though in some cases TypeScript can infer them
await db.get('a', { valueEncoding: db.valueEncoding('utf8') })

// It works the same for sublevels
const abc = db.sublevel('abc')
const xyz = db.sublevel<string, any>('xyz', { valueEncoding: 'json' })
```

</details>

## Supported Platforms

We aim to support Active LTS and Current Node.js releases, Electron >= 30, as well as any future Node.js and Electron releases thanks to [Node-API](https://nodejs.org/api/n-api.html).

The `classic-level` npm package ships with prebuilt binaries for popular 64-bit platforms as well as ARM, M1, Android, Alpine (musl), Windows 32-bit, Linux flavors with an old glibc (2.28) and is known to work on:

- **Linux**, including ARM platforms such as Raspberry Pi and Kindle
- **Mac OS** (10.7 and later)
- **Windows**.

When installing `classic-level`, [`node-gyp-build`](https://github.com/prebuild/node-gyp-build) will check if a compatible binary exists and fallback to compiling from source if it doesn't. In that case you'll need a [valid `node-gyp` installation](https://github.com/nodejs/node-gyp#installation).

If you don't want to use the prebuilt binary for the platform you are installing on, specify the `--build-from-source` flag when you install:

```
npm install classic-level --build-from-source
```

If you are working on `classic-level` itself and want to recompile the C++ code, run `npm run rebuild`.

## API

The API of `classic-level` follows that of [`abstract-level`](https://github.com/Level/abstract-level#public-api-for-consumers) with a few additional methods and options that are specific to LevelDB. The documentation below only covers the differences.

### `db = new ClassicLevel(location[, options])`

Create a database or open an existing database. The `location` argument must be a directory path (relative or absolute) where LevelDB will store its files. If the directory does not yet exist (and `options.createIfMissing` is true) it will be created recursively. Options are the same as in `abstract-level` except for the additional options accepted by `db.open()` and thus by this constructor.

A `classic-level` database obtains an exclusive lock. If another process or instance has already opened the underlying LevelDB store at the same `location` then opening will fail with error code [`LEVEL_LOCKED`](https://github.com/Level/abstract-level#errors).

### Opening

The [`db.open([options])`](https://github.com/Level/abstract-level#dbopenoptions) method has additional options:

- `multithreading` (boolean, default: `false`): allow multiple threads to access the database. This is only relevant when using [worker threads](https://nodejs.org/api/worker_threads.html).

It also has the following options for advanced performance tuning, only to be modified if you can prove actual benefit for your particular application.

<details>
<summary>Click to expand</summary>

- `compression` (boolean, default: `true`): Unless set to `false`, all _compressible_ data will be run through the Snappy compression algorithm before being stored. Snappy is very fast so leave this on unless you have good reason to turn it off.

- `cacheSize` (number, default: `8 * 1024 * 1024`): The size (in bytes) of the in-memory [LRU](http://en.wikipedia.org/wiki/Least_Recently_Used) cache with frequently used uncompressed block contents.

- `writeBufferSize` (number, default: `4 * 1024 * 1024`): The maximum size (in bytes) of the log (in memory and stored in the `.log` file on disk). Beyond this size, LevelDB will convert the log data to the first level of sorted table files. From LevelDB documentation:

  > Larger values increase performance, especially during bulk loads. Up to two write buffers may be held in memory at the same time, so you may wish to adjust this parameter to control memory usage. Also, a larger write buffer will result in a longer recovery time the next time the database is opened.

- `blockSize` (number, default: `4096`): The _approximate_ size of the blocks that make up the table files. The size relates to uncompressed data (hence "approximate"). Blocks are indexed in the table file and entry-lookups involve reading an entire block and parsing to discover the required entry.

- `maxOpenFiles` (number, default: `1000`): The maximum number of files that LevelDB is allowed to have open at a time. If your database is likely to have a large working set, you may increase this value to prevent file descriptor churn. To calculate the number of files required for your working set, divide your total data size by `maxFileSize`.

- `blockRestartInterval` (number, default: `16`): The number of entries before restarting the "delta encoding" of keys within blocks. Each "restart" point stores the full key for the entry, between restarts, the common prefix of the keys for those entries is omitted. Restarts are similar to the concept of keyframes in video encoding and are used to minimise the amount of space required to store keys. This is particularly helpful when using deep namespacing / prefixing in your keys.

- `maxFileSize` (number, default: `2 * 1024 * 1024`): The maximum amount of bytes to write to a file before switching to a new one. From LevelDB documentation:

  > If your filesystem is more efficient with larger files, you could consider increasing the value. The downside will be longer compactions and hence longer latency / performance hiccups. Another reason to increase this parameter might be when you are initially populating a large database.

</details>

### Closing

The [`db.close()`](https://github.com/Level/abstract-level#dbclose) method has an additional behavior: it waits for any pending operations to finish before closing. For example:

```js
// close() will wait for the put() to finish.
const promise1 = db.put('key', 'value')
const promise2 = db.close()
```

### Reading

The [`db.get(key[, options])`](https://github.com/Level/abstract-level#dbgetkey-options), [`db.getMany(keys[, options])`](https://github.com/Level/abstract-level#dbgetmanykeys-options) and [`db.iterator([options])`](https://github.com/Level/abstract-level#iterator--dbiteratoroptions) methods have an additional option:

- `fillCache` (boolean, default: `true`): unless set to `false`, LevelDB will fill its in-memory [LRU](http://en.wikipedia.org/wiki/Least_Recently_Used) cache with data that was read.

A `classic-level` database supports snapshots (as indicated by [`db.supports.snapshots`](https://github.com/Level/supports#snapshots-boolean)) which means `db.get()`, `db.getMany()` and `db.iterator()` read from a snapshot of the database, created synchronously at the time that `db.get()`, `db.getMany()` or `db.iterator()` was called. This means they will not see the data of simultaneous write operations, commonly referred to as having _snapshot guarantees_.

The [`db.iterator([options])`](https://github.com/Level/abstract-level#iterator--dbiteratoroptions) method also accepts:

- `highWaterMarkBytes` (number, default: `16 * 1024`): limit the amount of data that the iterator will hold in memory.

While [`iterator.nextv(size)`](https://github.com/Level/abstract-level#iteratornextvsize-options) is reading entries from LevelDB into memory, it sums up the byte length of those entries. If and when that sum has exceeded `highWaterMarkBytes`, reading will stop. If `nextv(2)` would normally yield two entries but the first entry is too large, then only one entry will be yielded. More `nextv(size)` calls must then be made to get the remaining entries.

If memory usage is less of a concern, increasing `highWaterMarkBytes` can increase the throughput of `nextv(size)`. If set to `0` then `nextv(size)` will never yield more than one entry, as `highWaterMarkBytes` will be exceeded on each call. It can not be set to `Infinity`. On key- and value iterators (see below) it applies to the byte length of keys or values respectively, rather than the combined byte length of keys _and_ values.

Optimal performance can be achieved by setting `highWaterMarkBytes` to at least `size` multiplied by the expected byte length of an entry, ensuring that `size` is always met. In other words, that `nextv(size)` will not stop reading before `size` amount of entries have been read into memory. If the iterator is wrapped in a [Node.js stream](https://github.com/Level/read-stream) or [Web Stream](https://github.com/Level/web-stream) then the `size` parameter is dictated by the stream's `highWaterMark` option. For example:

```js
const { EntryStream } = require('level-read-stream')

// If an entry is 50 bytes on average
const stream = new EntryStream(db, {
  highWaterMark: 1000,
  highWaterMarkBytes: 1000 * 50
})
```

Side note: the "watermark" analogy makes more sense in Node.js streams because its internal `highWaterMark` can grow, indicating the highest that the "water" has been. In a `classic-level` iterator however, `highWaterMarkBytes` is fixed once set. Getting exceeded does not change it.

The `highWaterMarkBytes` option is also applied to an internal cache that `classic-level` employs for [`next()`](https://github.com/Level/abstract-level#iteratornext) and [`for await...of`](https://github.com/Level/abstract-level#for-awaitof-iterator). When `next()` is called, that cache is populated with at most 1000 entries, or less than that if `highWaterMarkBytes` is exceeded by the total byte length of entries. To avoid reading too eagerly, the cache is not populated on the first `next()` call, or the first `next()` call after a `seek()`. Only on subsequent `next()` calls.

### Writing

The [`db.put(key, value[, options])`](https://github.com/Level/abstract-level#dbputkey-value-options), [`db.del(key[, options])`](https://github.com/Level/abstract-level#dbdelkey-options) and [`db.batch(operations[, options])`](https://github.com/Level/abstract-level#dbbatchoperations-options) and [`chainedBatch.write([options])`](https://github.com/Level/abstract-level#chainedbatchwriteoptions) methods have an additional option:

- `sync` (boolean, default: `false`): if set to `true`, LevelDB will perform a synchronous write of the data although the operation will be asynchronous as far as Node.js or Electron is concerned. Normally, LevelDB passes the data to the operating system for writing and returns immediately. In contrast, a synchronous write will use [`fsync()`](https://man7.org/linux/man-pages/man2/fsync.2.html) or equivalent, so the write will not complete until the data is actually on disk. Synchronous writes are significantly slower than asynchronous writes.

### Additional Methods

The following methods and properties are not part of the [`abstract-level`](https://github.com/Level/abstract-level) interface.

#### `db.location`

Read-only getter that returns the `location` string that was passed to the constructor (as-is).

#### `db.approximateSize(start, end[, options])`

Get the approximate number of bytes of file system space used by the range `[start..end)`. The result might not include recently written data. The optional `options` object may contain:

- `keyEncoding`: custom key encoding for this operation, used to encode `start` and `end`.

Returns a promise for a number.

#### `db.compactRange(start, end[, options])`

Manually trigger a database compaction in the range `[start..end]`. The optional `options` object may contain:

- `keyEncoding`: custom key encoding for this operation, used to encode `start` and `end`.

Returns a promise.

#### `db.getProperty(property)`

Get internal details from LevelDB. When issued with a valid `property` string, a string value is returned synchronously. Valid properties are:

- `leveldb.num-files-at-levelN`: return the number of files at level _N_, where N is an integer representing a valid level (e.g. "0").
- `leveldb.stats`: returns a multi-line string describing statistics about LevelDB's internal operation.
- `leveldb.sstables`: returns a multi-line string describing all of the _sstables_ that make up contents of the current database.

#### `ClassicLevel.destroy(location)`

Completely remove an existing LevelDB database directory. You can use this method in place of a full directory removal if you want to be sure to only remove LevelDB-related files. If the directory only contains LevelDB files, the directory itself will be removed as well. If there are additional, non-LevelDB files in the directory, those files and the directory will be left alone.

Returns a promise for the completion of the destroy operation.

Before calling `destroy()`, close a database if it's using the same `location`:

```js
const db = new ClassicLevel('./db')
await db.close()
await ClassicLevel.destroy('./db')
```

#### `ClassicLevel.repair(location)`

Attempt a restoration of a damaged database. It can also be used to perform a compaction of the LevelDB log into table files. From LevelDB documentation:

> If a DB cannot be opened, you may attempt to call this method to resurrect as much of the contents of the database as possible. Some data may be lost, so be careful when calling this function on a database that contains important information.

Returns a promise for the completion of the repair operation.

You will find information on the repair operation in the `LOG` file inside the database directory.

Before calling `repair()`, close a database if it's using the same `location`.

## Development

### Getting Started

This repository uses git submodules. Clone it recursively:

```bash
git clone --recurse-submodules https://github.com/Level/classic-level.git
```

Alternatively, initialize submodules inside the working tree:

```bash
cd classic-level
git submodule update --init --recursive
```

### Contributing

[`Level/classic-level`](https://github.com/Level/classic-level) is an **OPEN Open Source Project**. This means that:

> Individuals making significant and valuable contributions are given commit-access to the project to contribute as they see fit. This project is more like an open wiki than a standard guarded open source project.

See the [Contribution Guide](https://github.com/Level/community/blob/master/CONTRIBUTING.md) for more details.

### Publishing

1. Increment the version: `npm version ..`
2. Push to GitHub: `git push --follow-tags`
3. Wait for CI to complete
4. Download prebuilds into `./prebuilds`: `npm run download-prebuilds`
5. Optionally verify loading a prebuild: `npm run test-prebuild`
6. Optionally verify which files npm will include: `canadian-pub`
7. Finally: `npm publish`

## Donate

Support us with a monthly donation on [Open Collective](https://opencollective.com/level) and help us continue our work.

## License

[MIT](LICENSE)

[level-badge]: https://leveljs.org/img/badge.svg
