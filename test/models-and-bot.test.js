const test = require("node:test");
const assert = require("node:assert/strict");

const PubgPlan = require("../models/pubg-plan.model");
const UzumOrder = require("../models/uzum-order.model");
const { parseAdminIds, parsePrice } = require("../bot/admin-bot");

test("standalone plan stores Uzum price and activation", () => {
  assert.ok(PubgPlan.schema.path("price"));
  assert.ok(PubgPlan.schema.path("isActive"));
  assert.ok(PubgPlan.schema.path("providerProductId"));
});

test("standalone order has a unique Uzum transaction id", () => {
  assert.ok(UzumOrder.schema.path("transId"));
  assert.ok(UzumOrder.schema.path("confirmedAt"));
  assert.ok(UzumOrder.schema.path("lockToken"));
});

test("admin ids and UZS price input are normalized", () => {
  assert.deepEqual([...parseAdminIds("123, 456")], ["123", "456"]);
  assert.equal(parsePrice("13 000"), 13000);
  assert.equal(parsePrice("13,000"), 13000);
  assert.equal(parsePrice("13.5"), null);
});
