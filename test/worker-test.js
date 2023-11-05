"use strict";

const { parentPort, workerData } = require("worker_threads");
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
  getRandomValue,
  createRandomKeys,
  getRandomKeys,
} = require("./worker-utils");

(async function main() {
  const db = new ClassicLevel(workerData.location);
  await db.open({ allowMultiThreading: true });

  try {
    /**
     * test "open/close mutex works as expected"
     */
    if (workerData.workerStartup) {
      setTimeout(() => {
        db.close()
          .catch((err) => {
            parentPort.postMessage({
              message: WORKER_ERROR_MESSAGE,
              error: err.message,
            });
          })
          .then(() => {
            parentPort.postMessage({
              message: CLOSED_DB_MESSAGE,
            });
          });
      }, getRandomValue(1, 100));
      return;
    }

    /**
     * test "allow multi-threading by same process"
     */
    if (workerData.readWrite) {
      parentPort.once("message", ({ message }) => {
        if (message !== START_READING_MESSAGE) {
          return parentPort.postMessage({
            message: WORKER_ERROR_MESSAGE,
            error: `did not receive '${START_READING_MESSAGE}' message`,
          });
        }
        getRandomKeys(db, MIN_KEY, MAX_KEY)
          .then(() => db.close())
          .catch((err) =>
            parentPort.postMessage({
              message: WORKER_ERROR_MESSAGE,
              error: err.message,
            })
          );
      });

      parentPort.postMessage({ message: WORKER_CREATING_KEYS_MESSAGE });
      await createRandomKeys(db, MIN_KEY, MID_KEY).catch((err) => {
        parentPort.removeAllListeners("message");
        parentPort.postMessage({
          message: WORKER_ERROR_MESSAGE,
          error: err.message,
        });
      });
      parentPort.postMessage({ message: WORKER_READY_TO_READ_MESSAGE });

      return;
    }

    parentPort.postMessage({
      message: WORKER_ERROR_MESSAGE,
      error: "invalid workerData",
    });
  } catch (err) {
    parentPort.postMessage({
      message: WORKER_ERROR_MESSAGE,
      error: err.message,
    });
  }
})();
