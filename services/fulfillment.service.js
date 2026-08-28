const crypto = require("node:crypto");
const UzumOrder = require("../models/uzum-order.model");
const { createOrder, getOrder } = require("./gw-api.service");
const { checkGwBalanceAfterSale } = require("./gw-balance-alert.service");

let recoveryTimer = null;

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function isAutobuyEnabled() {
  return enabled(process.env.GW_PUBG_AUTOBUY_ENABLED);
}

function normalizeProviderStatus(payload) {
  return String(payload?.status || payload?.order?.status || "").trim().toLowerCase();
}

function getProviderOrderId(payload) {
  return String(
    payload?.orderId ||
    payload?.id ||
    payload?.order?.orderId ||
    payload?.order?.id ||
    "",
  ).trim();
}

function classifyProviderPayload(payload) {
  const status = normalizeProviderStatus(payload);
  if (status === "completed") return "confirmed";
  if (
    ["cancelled", "canceled", "failed", "rejected", "error"].includes(status) ||
    payload?.orderCreated === false
  ) {
    return "failed";
  }
  return "processing";
}

function providerError(payload, fallback = "") {
  return String(
    payload?.error ||
    payload?.code ||
    payload?.message ||
    fallback ||
    "GW order failed",
  ).trim().slice(0, 500);
}

function isDefinitiveSubmitFailure(error, payload) {
  const status = Number(error?.response?.status || 0);
  if ([400, 401, 403].includes(status)) return true;
  return payload?.orderCreated === false || classifyProviderPayload(payload) === "failed";
}

function getProcessLockMs() {
  const apiTimeout = Math.max(3_000, Number(process.env.GW_API_TIMEOUT_MS || 20_000));
  return Math.max(apiTimeout + 15_000, Number(process.env.GW_PUBG_PROCESS_LOCK_MS || 60_000));
}

function getProviderPollIntervalMs() {
  return Math.max(1_000, Number(process.env.GW_PUBG_POLL_INTERVAL_MS || 5_000));
}

function isTerminal(order) {
  return ["confirmed", "failed", "needs_review"].includes(String(order?.state || ""));
}

async function acquireLock(orderId, allowCreated) {
  const now = new Date();
  const token = crypto.randomUUID();
  const allowedStates = allowCreated ? ["created", "processing"] : ["processing"];
  const order = await UzumOrder.findOneAndUpdate(
    {
      _id: orderId,
      state: { $in: allowedStates },
      $or: [
        { lockUntil: null },
        { lockUntil: { $exists: false } },
        { lockUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        lockToken: token,
        lockUntil: new Date(now.getTime() + getProcessLockMs()),
      },
    },
    { new: true },
  ).lean();
  return order ? { order, token } : null;
}

async function releaseLock(orderId, token) {
  await UzumOrder.updateOne(
    { _id: orderId, lockToken: token },
    { $set: { lockToken: "", lockUntil: null } },
  );
}

async function applyProviderPayload(order, payload, { isPoll = false } = {}) {
  const classification = classifyProviderPayload(payload);
  const providerOrderId = getProviderOrderId(payload) || String(order.providerOrderId || "");
  const common = {
    providerOrderId,
    providerStatus: normalizeProviderStatus(payload),
    providerResponse: payload || null,
    lastProviderCheckAt: new Date(),
    lastError: "",
  };

  if (classification === "confirmed") {
    const confirmed = await UzumOrder.findByIdAndUpdate(
      order._id,
      {
        $set: {
          ...common,
          state: "confirmed",
          phase: "completed",
          confirmedAt: new Date(),
          lockToken: "",
          lockUntil: null,
        },
      },
      { new: true },
    ).lean();
    const claimed = await UzumOrder.findOneAndUpdate(
      { _id: order._id, gwBalanceAlertCheckedAt: null },
      { $set: { gwBalanceAlertCheckedAt: new Date() } },
      { new: true },
    ).lean();
    if (claimed) {
      void checkGwBalanceAfterSale(order._id).catch((error) => {
        console.error("Uzum GW balance alert error:", order._id, error.message);
      });
    }
    return confirmed;
  }

  if (classification === "failed") {
    return UzumOrder.findByIdAndUpdate(
      order._id,
      {
        $set: {
          ...common,
          state: "failed",
          phase: "failed",
          failedAt: new Date(),
          lastError: providerError(payload),
          lockToken: "",
          lockUntil: null,
        },
      },
      { new: true },
    ).lean();
  }

  const nextPollAttempts = Number(order.pollAttempts || 0) + (isPoll ? 1 : 0);
  const maxPollAttempts = Math.max(1, Number(process.env.GW_PUBG_MAX_POLL_ATTEMPTS || 24));
  if (isPoll && nextPollAttempts >= maxPollAttempts) {
    return UzumOrder.findByIdAndUpdate(
      order._id,
      {
        $set: {
          ...common,
          state: "needs_review",
          phase: "polling",
          pollAttempts: nextPollAttempts,
          lastError: "GW status polling timeout",
          lockToken: "",
          lockUntil: null,
        },
      },
      { new: true },
    ).lean();
  }

  return UzumOrder.findByIdAndUpdate(
    order._id,
    {
      $set: {
        ...common,
        state: "processing",
        phase: providerOrderId ? "polling" : "submit_unknown",
        pollAttempts: nextPollAttempts,
      },
    },
    { new: true },
  ).lean();
}

async function markSubmitError(order, error) {
  const payload = error?.response?.data;
  if (payload && (
    getProviderOrderId(payload) ||
    classifyProviderPayload(payload) !== "processing"
  )) {
    return applyProviderPayload(order, payload);
  }
  if (isDefinitiveSubmitFailure(error, payload)) {
    return applyProviderPayload(order, {
      status: "failed",
      error: String(error?.message || "GW submit failed"),
    });
  }

  return UzumOrder.findByIdAndUpdate(
    order._id,
    {
      $set: {
        state: "processing",
        phase: "submit_unknown",
        providerResponse: payload || null,
        providerStatus: normalizeProviderStatus(payload),
        providerOrderId: getProviderOrderId(payload) || String(order.providerOrderId || ""),
        lastProviderCheckAt: new Date(),
        lastError: String(error?.message || "GW submit result unknown").slice(0, 500),
      },
    },
    { new: true },
  ).lean();
}

async function processOrder(orderId, { allowSubmit = false } = {}) {
  if (!isAutobuyEnabled()) {
    return UzumOrder.findById(orderId).lean();
  }

  const claimed = await acquireLock(orderId, allowSubmit);
  if (!claimed) return UzumOrder.findById(orderId).lean();

  const { token } = claimed;
  let order = claimed.order;
  try {
    if (order.state === "created") {
      order = await UzumOrder.findOneAndUpdate(
        { _id: order._id, lockToken: token, state: "created" },
        {
          $set: {
            state: "processing",
            phase: "submit_started",
            confirmStartedAt: new Date(),
          },
        },
        { new: true },
      ).lean();
      if (!order) return UzumOrder.findById(orderId).lean();
    } else {
      const lastCheck = new Date(order.lastProviderCheckAt || 0).getTime();
      if (lastCheck > 0 && Date.now() - lastCheck < getProviderPollIntervalMs()) {
        return order;
      }
    }

    if (order.phase === "polling" && order.providerOrderId) {
      try {
        const payload = await getOrder(order.providerOrderId);
        return applyProviderPayload(order, payload, { isPoll: true });
      } catch (error) {
        const nextPollAttempts = Number(order.pollAttempts || 0) + 1;
        const maxPollAttempts = Math.max(
          1,
          Number(process.env.GW_PUBG_MAX_POLL_ATTEMPTS || 24),
        );
        const needsReview = nextPollAttempts >= maxPollAttempts;
        await UzumOrder.updateOne(
          { _id: order._id },
          {
            $set: {
              state: needsReview ? "needs_review" : "processing",
              lastProviderCheckAt: new Date(),
              lastError: String(
                needsReview ? "GW status result unknown" : error?.message || "GW status error",
              ).slice(0, 500),
              pollAttempts: nextPollAttempts,
            },
          },
        );
        return UzumOrder.findById(order._id).lean();
      }
    }

    const submitAttempts = Number(order.submitAttempts || 0) + 1;
    await UzumOrder.updateOne(
      { _id: order._id },
      {
        $set: { phase: "submit_started", lastProviderCheckAt: new Date() },
        $setOnInsert: { confirmStartedAt: new Date() },
        $inc: { submitAttempts: 1 },
      },
    );
    order.submitAttempts = submitAttempts;

    try {
      const payload = await createOrder({
        pid: order.providerProductId,
        userId: order.playerId,
        trxid: order.providerTrxId,
        idempotencyKey: order.providerTrxId,
      });
      return applyProviderPayload(order, payload);
    } catch (error) {
      return markSubmitError(order, error);
    }
  } finally {
    await releaseLock(orderId, token);
  }
}

async function confirmAndWait(orderId) {
  const waitMs = Math.max(0, Number(process.env.UZUM_PUBG_CONFIRM_WAIT_MS || 125_000));
  const checkIntervalMs = Math.max(
    100,
    Number(process.env.UZUM_PUBG_CONFIRM_CHECK_INTERVAL_MS || 500),
  );
  const deadline = Date.now() + waitMs;

  let order = await processOrder(orderId, { allowSubmit: true });
  while (order && !isTerminal(order) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(checkIntervalMs, deadline - Date.now())));
    order = await processOrder(orderId);
  }
  return order || UzumOrder.findById(orderId).lean();
}

async function recoverProcessingOrders() {
  if (!isAutobuyEnabled()) return;
  const orders = await UzumOrder.find({ state: "processing" })
    .sort({ updatedAt: 1 })
    .limit(20)
    .select({ _id: 1 })
    .lean();
  for (const order of orders) {
    await processOrder(order._id).catch((error) => {
      console.error("Uzum order recovery error:", order._id, error.message);
    });
  }
}

function startRecoveryWorker() {
  const intervalMs = Math.max(
    1_000,
    Number(process.env.GW_PUBG_RECOVERY_INTERVAL_MS || 5_000),
  );
  recoveryTimer = setInterval(() => {
    recoverProcessingOrders().catch((error) => {
      console.error("Uzum recovery worker error:", error.message);
    });
  }, intervalMs);
  recoveryTimer.unref?.();
}

function stopRecoveryWorker() {
  if (recoveryTimer) clearInterval(recoveryTimer);
  recoveryTimer = null;
}

module.exports = {
  classifyProviderPayload,
  getProviderOrderId,
  normalizeProviderStatus,
  isAutobuyEnabled,
  isTerminal,
  processOrder,
  confirmAndWait,
  recoverProcessingOrders,
  startRecoveryWorker,
  stopRecoveryWorker,
};
