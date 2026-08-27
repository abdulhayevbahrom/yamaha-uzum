const test = require("node:test");
const assert = require("node:assert/strict");

const {
  decodeBasicAuth,
  parseServiceIds,
  safeEqual,
} = require("../middleware/uzum-auth.middleware");
const {
  getPlanCode,
  getPlayerId,
  getTransId,
  getPriceAmount,
} = require("../controllers/uzum-pubg.controller");

test("Basic auth login and password are decoded", () => {
  const token = Buffer.from("uzum-login:uzum-password").toString("base64");
  assert.deepEqual(decodeBasicAuth(`Basic ${token}`), {
    login: "uzum-login",
    password: "uzum-password",
  });
  assert.equal(safeEqual("secret", "secret"), true);
  assert.equal(safeEqual("secret", "different"), false);
});

test("configured service ids are normalized", () => {
  assert.deepEqual(parseServiceIds("7814652, 7814653,invalid"), [7814652, 7814653]);
});

test("Uzum request fields use the documented nested format", () => {
  const body = {
    serviceId: 7814652,
    transId: "transaction-1",
    params: { player_id: "512345678", code: 60 },
    price_amount: 1300000,
  };
  assert.equal(getPlanCode(body), "60");
  assert.equal(getPlayerId(body), "512345678");
  assert.equal(getTransId(body), "transaction-1");
  assert.equal(getPriceAmount(body), 1300000);
});

test("price_amount must be a positive integer number of tiyin", () => {
  assert.equal(getPriceAmount({ price_amount: 1300000.5 }), 0);
  assert.equal(getPriceAmount({ price_amount: -1 }), 0);
  assert.equal(getPriceAmount({ price_amount: "1300000" }), 1300000);
});
