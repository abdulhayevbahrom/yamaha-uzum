const test = require("node:test");
const assert = require("node:assert/strict");

function clone(value) {
  return value ? structuredClone(value) : value;
}

test("parallel confirms submit exactly one GW order", async () => {
  const previousEnabled = process.env.GW_PUBG_AUTOBUY_ENABLED;
  const previousWait = process.env.UZUM_PUBG_CONFIRM_WAIT_MS;
  const previousCheck = process.env.UZUM_PUBG_CONFIRM_CHECK_INTERVAL_MS;
  process.env.GW_PUBG_AUTOBUY_ENABLED = "true";
  process.env.UZUM_PUBG_CONFIRM_WAIT_MS = "500";
  process.env.UZUM_PUBG_CONFIRM_CHECK_INTERVAL_MS = "100";

  let order = {
    _id: "order-1",
    state: "created",
    phase: "created",
    playerId: "512345678",
    providerProductId: "GW60",
    providerTrxId: "YUZ-PUBG-order-1",
    providerOrderId: "",
    submitAttempts: 0,
    pollAttempts: 0,
    lockToken: "",
    lockUntil: null,
    lastProviderCheckAt: null,
  };

  const applyUpdate = (update) => {
    if (update?.$set) Object.assign(order, clone(update.$set));
    if (update?.$inc) {
      for (const [key, value] of Object.entries(update.$inc)) {
        order[key] = Number(order[key] || 0) + Number(value || 0);
      }
    }
  };
  const query = (value) => ({ lean: async () => clone(value) });
  const fakeOrderModel = {
    findOneAndUpdate: (filter, update) => query((() => {
      if (filter?.state?.$in) {
        const lockAvailable = !order.lockUntil || new Date(order.lockUntil).getTime() <= Date.now();
        if (!filter.state.$in.includes(order.state) || !lockAvailable) return null;
      }
      if (filter?.state && typeof filter.state === "string" && order.state !== filter.state) {
        return null;
      }
      if (filter?.lockToken && order.lockToken !== filter.lockToken) return null;
      applyUpdate(update);
      return order;
    })()),
    findById: () => query(order),
    findByIdAndUpdate: (_id, update) => query((() => {
      applyUpdate(update);
      return order;
    })()),
    updateOne: async (filter, update) => {
      if (filter?.lockToken && order.lockToken !== filter.lockToken) return { modifiedCount: 0 };
      applyUpdate(update);
      return { modifiedCount: 1 };
    },
  };

  let submitCount = 0;
  const fakeGwApi = {
    createOrder: async () => {
      submitCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { orderId: "gw-order-1", status: "completed" };
    },
    getOrder: async () => ({ orderId: "gw-order-1", status: "completed" }),
  };

  const modelPath = require.resolve("../models/uzum-order.model");
  const apiPath = require.resolve("../services/gw-api.service");
  const servicePath = require.resolve("../services/fulfillment.service");
  require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: fakeOrderModel };
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: fakeGwApi };
  delete require.cache[servicePath];

  try {
    const { confirmAndWait } = require("../services/fulfillment.service");
    const [first, second] = await Promise.all([
      confirmAndWait(order._id),
      confirmAndWait(order._id),
    ]);
    assert.equal(first.state, "confirmed");
    assert.equal(second.state, "confirmed");
    assert.equal(submitCount, 1);
  } finally {
    if (typeof previousEnabled === "undefined") delete process.env.GW_PUBG_AUTOBUY_ENABLED;
    else process.env.GW_PUBG_AUTOBUY_ENABLED = previousEnabled;
    if (typeof previousWait === "undefined") delete process.env.UZUM_PUBG_CONFIRM_WAIT_MS;
    else process.env.UZUM_PUBG_CONFIRM_WAIT_MS = previousWait;
    if (typeof previousCheck === "undefined") delete process.env.UZUM_PUBG_CONFIRM_CHECK_INTERVAL_MS;
    else process.env.UZUM_PUBG_CONFIRM_CHECK_INTERVAL_MS = previousCheck;
  }
});
