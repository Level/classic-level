const MIN_KEY = 1;
const MAX_KEY = 100;
const TEST_INTERVAL_MS = 1000;

exports.createRandomKeys = async (db) => {
  for (let i = MIN_KEY; i <= MAX_KEY; i++) {
    await db.put(`key${i}`, `value${i}`);
  }
};

exports.getRandomKeys = async (db, thread) => {
  const start = Date.now();
  while (Date.now() - start < TEST_INTERVAL_MS) {
    const randomKey = Math.floor(
      Math.random() * (MAX_KEY - MIN_KEY + 1) + MIN_KEY
    );
    // console.log(thread + ": got " +
    await db.get(`key${randomKey}`);
    // );
  }
};
