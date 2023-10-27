"use strict";

const test = require("tape");
const tempy = require("tempy");
const path = require("path");
const { Worker } = require("worker_threads");
const { ClassicLevel } = require("..");
const { createRandomKeys, getRandomKeys } = require("./worker-utils");

test("allow multi-threading by same process", async function (t) {
  t.plan(2);
  const location = tempy.directory();
  const db = new ClassicLevel(location);
  await db.open();
  await createRandomKeys(db);

  const worker = new Worker(path.join(__dirname, "worker-test.js"), {
    workerData: { location },
  });

  function onMessage(_) {
    getRandomKeys(db, "main").catch((err) => {
      worker.removeListener("error", onError);
      onError(err);
    });
  }
  worker.on("message", onMessage);

  function onError(err) {
    worker.removeListener("message", onMessage);
    worker.removeListener("exit", onExit);
    t.ifError(err, "worker error");
    db.close(t.ifError.bind(t));
  }
  worker.once("error", onError);

  function onExit(code) {
    worker.removeListener("message", onMessage);
    worker.removeListener("error", onError);
    t.equal(code, 0, 'child exited normally');
    db.close(t.ifError.bind(t));
  }
  worker.once("exit", onExit);
});
