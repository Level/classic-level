"use strict";

const { parentPort, workerData } = require("worker_threads");
const { ClassicLevel } = require("..");
const { getRandomKeys } = require("./worker-utils");

(async function main() {
  const db = new ClassicLevel(workerData.location);
  await db.open({ allowMultiThreading: true });

  parentPort.postMessage("starting");

  await getRandomKeys(db, "worker");
  await db.close();
})();
