"use strict";

const { parentPort, workerData } = require("worker_threads");
const { ClassicLevel } = require("..");
const { CLOSED_DB_MESSAGE, getRandomValue } = require("./worker-utils");

(async function main() {
  const db = new ClassicLevel(workerData.location);
  await db.open({ allowMultiThreading: true });

  setTimeout(() => {
    db.close().then(() => {
      parentPort.postMessage(CLOSED_DB_MESSAGE);
    });
  }, getRandomValue(1, 100));
})();
