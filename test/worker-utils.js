exports.CLOSED_DB_MESSAGE = "closed db";

function getRandomValue(minValue, maxValue) {
  return Math.floor(Math.random() * (maxValue - minValue + 1) + minValue);
}
exports.getRandomValue = getRandomValue;
