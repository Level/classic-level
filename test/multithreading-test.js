"use strict";

const test = require("tape");
const tempy = require("tempy");
const path = require("path");
const { Worker } = require("worker_threads");
const { ClassicLevel } = require("..");
const {
  MIN_KEY,
  MID_KEY,
  MAX_KEY,
  CLOSED_DB_MESSAGE,
  WORKER_CREATING_KEYS_MESSAGE,
  WORKER_READY_TO_READ_MESSAGE,
  WORKER_ERROR_MESSAGE,
  START_READING_MESSAGE,
  createRandomKeys,
  getRandomKeys,
} = require("./worker-utils");

/**
 * Makes sure that the allowMultiThreading flag is working as expected
 */
test("check allowMultiThreading flag works as expected", async function (t) {
  t.plan(5);
  const location = tempy.directory();
  const db1 = new ClassicLevel(location);
  await db1.open({ location });
  t.is(db1.location, location);

  const db2 = new ClassicLevel(location);
  await db2.open({ location, allowMultiThreading: true });
  t.is(db2.location, location);

  const db3 = new ClassicLevel(location);
  try {
    await db3.open({ location, allowMultiThreading: false });
  } catch (err) {
    t.is(err.code, "LEVEL_DATABASE_NOT_OPEN", "third instance failed to open");
    t.is(err.cause.code, "LEVEL_LOCKED", "third instance got lock error");
  }

  await db1.close();
  await db2.close();

  const db4 = new ClassicLevel(location);
  await db4.open({ location, allowMultiThreading: false });
  t.is(db4.location, location);
  await db4.close();
});

/**
 * Tests for interleaved opening and closing of the database to check
 * that the mutex for guarding the handles is working as expected
 */
test("open/close mutex works as expected", async function (t) {
  t.plan(2);
  const location = tempy.directory();
  const db1 = new ClassicLevel(location);
  await db1.open({ location });
  t.is(db1.location, location);

  const activeWorkers = [];

  for (let i = 0; i < 100; i++) {
    const worker = new Worker(path.join(__dirname, "worker-test.js"), {
      workerData: { location, workerStartup: true },
    });

    activeWorkers.push(
      new Promise((resolve, reject) => {
        worker.once("message", ({ message, error }) => {
          if (message === WORKER_ERROR_MESSAGE) {
            return reject(error);
          }
          if (message === CLOSED_DB_MESSAGE) {
            return resolve();
          }
          return reject("unexpected error\n>>> " + error);
        });
      })
    );
  }

  const results = await Promise.allSettled(activeWorkers);
  const rejected = results.filter((res) => res.status === "rejected");
  t.is(rejected.length, 0);

  await db1.close();
});

test("allow multi-threading by same process", async function (t) {
  try {
    const location = tempy.directory();
    const db = new ClassicLevel(location);

    const worker = new Worker(path.join(__dirname, "worker-test.js"), {
      workerData: { location, readWrite: true },
    });

    function cleanup(err) {
      worker.removeAllListeners("message");
      worker.removeAllListeners("error");
      worker.terminate();
      if (err) {
        throw err;
      }
    }

    worker.on("error", cleanup);
    worker.on("message", ({ message, error }) => {
      if (message === WORKER_ERROR_MESSAGE) {
        cleanup(new Error(error));
      }
    });

    // Concurrently write keys to the db on both thread and wait
    // until ready before attempting to concurrently read keys
    const workerReady = new Promise((resolve) => {
      let mainThreadReady = false;
      worker.on("message", ({ message }) => {
        if (message === WORKER_CREATING_KEYS_MESSAGE) {
          createRandomKeys(db, MID_KEY, MAX_KEY).then(() => {
            mainThreadReady = true;
          });
        } else if (message === WORKER_READY_TO_READ_MESSAGE) {
          const interval = setInterval(() => {
            if (mainThreadReady) {
              clearInterval(interval);
              resolve();
            }
          }, 100);
        }
      });
    });

    await workerReady;

    // once db is seeded start reading keys from both threads
    worker.postMessage({ message: START_READING_MESSAGE });
    await getRandomKeys(db, MIN_KEY, MAX_KEY);
    await db.close();

    t.end();
  } catch (error) {
    t.fail(error.message);
    t.end();
  }
});
