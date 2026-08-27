const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyProviderPayload,
  getProviderOrderId,
  normalizeProviderStatus,
  isTerminal,
} = require("../services/fulfillment.service");
const { mapOrderState } = require("../scripts/migrate-from-yamaha");

test("GW completed result is the only confirmed sale result", () => {
  assert.equal(classifyProviderPayload({ status: "completed" }), "confirmed");
  assert.equal(classifyProviderPayload({ status: "pending" }), "processing");
  assert.equal(classifyProviderPayload({ status: "failed" }), "failed");
  assert.equal(classifyProviderPayload({ orderCreated: false }), "failed");
});

test("nested GW order response fields are supported", () => {
  const payload = { order: { id: "gw-123", status: "completed" } };
  assert.equal(getProviderOrderId(payload), "gw-123");
  assert.equal(normalizeProviderStatus(payload), "completed");
});

test("only terminal internal states stop confirm waiting", () => {
  assert.equal(isTerminal({ state: "created" }), false);
  assert.equal(isTerminal({ state: "processing" }), false);
  assert.equal(isTerminal({ state: "confirmed" }), true);
  assert.equal(isTerminal({ state: "failed" }), true);
  assert.equal(isTerminal({ state: "needs_review" }), true);
});

test("legacy Yamaha orders retain their fulfillment state", () => {
  assert.deepEqual(
    mapOrderState({ status: "completed", fulfillmentStatus: "success" }),
    { state: "confirmed", phase: "completed" },
  );
  assert.deepEqual(
    mapOrderState({ status: "paid_auto_processed", fulfillmentStatus: "pending" }),
    { state: "created", phase: "created" },
  );
});
