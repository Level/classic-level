"use strict";

const test = require("tape");
const tempy = require("tempy");
const path = require("path");
const { Worker } = require("worker_threads");
const { ClassicLevel } = require("..");
const { CLOSED_DB_MESSAGE } = require("./worker-utils");

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
      workerData: {
        location,
      },
    });

    activeWorkers.push(
      new Promise((resolve, reject) => {
        worker.once("error", (err) => {
          worker.removeAllListeners("message");
          reject(err);
        });
        worker.once("message", (message) => {
          if (message !== CLOSED_DB_MESSAGE) {
            return reject("did not receive correct message");
          }
          worker.removeAllListeners("error");
          resolve();
        });
      })
    );
  }

  const results = await Promise.allSettled(activeWorkers);
  const rejected = results.filter((res) => res.status === "rejected");
  t.is(rejected.length, 0);

  await db1.close();
});
