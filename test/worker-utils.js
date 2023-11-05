exports.TEST_INTERVAL_MS = 1000;

exports.MIN_KEY = 1;
exports.MAX_KEY = 1000;
exports.MID_KEY = exports.MAX_KEY / 2;

exports.CLOSED_DB_MESSAGE = "closed db";
exports.WORKER_CREATING_KEYS_MESSAGE = "worker creating keys";
exports.WORKER_READY_TO_READ_MESSAGE = "worker ready to read keys";
exports.WORKER_ERROR_MESSAGE = "worker error";
exports.START_READING_MESSAGE = "start reading";

function getRandomValue(minValue, maxValue) {
  return Math.floor(Math.random() * (maxValue - minValue + 1) + minValue);
}
exports.getRandomValue = getRandomValue;

exports.createRandomKeys = async (db, minKey, maxKey) => {
  for (let i = minKey; i <= maxKey; i++) {
    await db.put(`key${i}`, `value${i}`);
  }
};

exports.getRandomKeys = async (db, minKey, maxKey) => {
  const start = Date.now();
  while (Date.now() - start < exports.TEST_INTERVAL_MS) {
    const randomKey = getRandomValue(minKey, maxKey);
    await db.get(`key${randomKey}`);
  }
};
