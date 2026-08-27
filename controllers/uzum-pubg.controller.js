const UzumOrder = require("../models/uzum-order.model");
const { verifyPubgPlayer } = require("../services/gw-api.service");
const { listActivePlans, findActivePlan } = require("../services/catalog.service");
const {
  confirmAndWait,
  isAutobuyEnabled,
} = require("../services/fulfillment.service");
const { sendFailure, sendSuccess, toTimestamp } = require("../utils/uzum-response");

function normalize(value) {
  return String(value || "").trim();
}

function getPlanCode(body) {
  return normalize(
    body?.code ||
    body?.params?.code ||
    body?.planCode ||
    body?.params?.planCode ||
    body?.params?.quantity ||
    body?.params?.amount,
  );
}

function getPlayerId(body) {
  return normalize(body?.playerId || body?.params?.player_id || body?.params?.playerId);
}

function getTransId(body) {
  return normalize(body?.transId || body?.transactionId || body?.params?.transactionId);
}

function getPriceAmount(body) {
  const raw = body?.price_amount ?? body?.amount ?? body?.params?.price_amount ?? body?.params?.amount;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function isPlayerNotFound(error) {
  const status = Number(error?.response?.status || 0);
  return [400, 404, 422].includes(status) || error?.code === "PLAYER_NOT_FOUND";
}

function confirmedPayload(serviceId, transId, order) {
  return {
    serviceId,
    transId,
    confirmTime: toTimestamp(order.confirmedAt),
    status: "CONFIRMED",
    data: {},
    amount: Number(order.amountTiyin || 0),
  };
}

async function verifyPlayer(playerId, tracePrefix, serviceId) {
  const trxid = `${tracePrefix}-${serviceId}-${Date.now()}`.slice(0, 80);
  const verify = await verifyPubgPlayer(playerId, trxid);
  const profileName = normalize(verify?.playerName || verify?.name);
  return verify?.success && profileName ? profileName : "";
}

async function catalog(req, res) {
  const serviceId = req.uzumServiceId;
  try {
    const plans = await listActivePlans();
    return sendSuccess(res, {
      serviceId,
      timestamp: Date.now(),
      status: "OK",
      data: {
        game: { value: "PUBG UC" },
        plans: plans.map((plan) => ({
          code: String(plan.code),
          label: String(plan.label),
          price: Number(plan.price),
        })),
      },
    });
  } catch (error) {
    console.error("Uzum catalog error:", error.message);
    return sendFailure(res, serviceId, "99999");
  }
}

async function check(req, res) {
  const serviceId = req.uzumServiceId;
  const playerId = getPlayerId(req.body);
  const planCode = getPlanCode(req.body);
  if (!playerId || !planCode) return sendFailure(res, serviceId, "10005");
  if (!/^5\d+$/.test(playerId)) return sendFailure(res, serviceId, "10007");

  const plan = await findActivePlan(planCode);
  if (!plan) return sendFailure(res, serviceId, "10007");

  try {
    const profileName = await verifyPlayer(playerId, "UZM-PUBG-CHK", serviceId);
    if (!profileName) return sendFailure(res, serviceId, "10007");
    return sendSuccess(res, {
      serviceId,
      timestamp: Date.now(),
      status: "OK",
      data: {
        player_id: { value: playerId },
        profile_name: { value: profileName },
        amount: { value: String(plan.price) },
      },
    });
  } catch (error) {
    if (isPlayerNotFound(error)) return sendFailure(res, serviceId, "10007");
    console.error("Uzum player check error:", error.message);
    return sendFailure(res, serviceId, "99999");
  }
}

async function create(req, res) {
  const serviceId = req.uzumServiceId;
  const transId = getTransId(req.body);
  const playerId = getPlayerId(req.body);
  const planCode = getPlanCode(req.body);
  const priceAmount = getPriceAmount(req.body);
  if (!transId || !playerId || !planCode || !priceAmount) {
    return sendFailure(res, serviceId, "10005");
  }
  if (!/^5\d+$/.test(playerId)) return sendFailure(res, serviceId, "10007");

  const duplicate = await UzumOrder.findOne({ transId }).lean();
  if (duplicate) {
    return sendFailure(res, serviceId, "10008", {
      transId,
      transTime: toTimestamp(duplicate.createdAt),
    });
  }

  const plan = await findActivePlan(planCode);
  if (!plan) return sendFailure(res, serviceId, "10007");
  const expectedAmountTiyin = Math.round(Number(plan.price || 0)) * 100;
  if (priceAmount !== expectedAmountTiyin) {
    return sendFailure(res, serviceId, "10011");
  }

  let profileName;
  try {
    profileName = await verifyPlayer(playerId, "UZM-PUBG-CRT", serviceId);
    if (!profileName) return sendFailure(res, serviceId, "10007");
  } catch (error) {
    if (isPlayerNotFound(error)) return sendFailure(res, serviceId, "10007");
    console.error("Uzum create verify error:", error.message);
    return sendFailure(res, serviceId, "99999");
  }

  try {
    const order = new UzumOrder({
      serviceId,
      transId,
      playerId,
      profileName,
      planCode: plan.code,
      planLabel: plan.label,
      priceUzs: plan.price,
      amountTiyin: expectedAmountTiyin,
      providerProductId: plan.providerProductId,
      state: "created",
      phase: "created",
    });
    order.providerTrxId = `YUZ-PUBG-${order._id}`.slice(0, 80);
    await order.save();

    return sendSuccess(res, {
      serviceId,
      transId,
      status: "CREATED",
      transTime: toTimestamp(order.createdAt),
      data: {},
      amount: expectedAmountTiyin,
    });
  } catch (error) {
    if (Number(error?.code || 0) === 11000) {
      const existing = await UzumOrder.findOne({ transId }).lean();
      return sendFailure(res, serviceId, "10008", {
        transId,
        transTime: toTimestamp(existing?.createdAt),
      });
    }
    console.error("Uzum create order error:", error.message);
    return sendFailure(res, serviceId, "10009");
  }
}

async function confirm(req, res) {
  const serviceId = req.uzumServiceId;
  const transId = getTransId(req.body);
  if (!transId) return sendFailure(res, serviceId, "10005");

  let order = await UzumOrder.findOne({ transId, serviceId }).lean();
  if (!order) return sendFailure(res, serviceId, "10014", { transId });
  if (order.state === "confirmed") {
    return sendSuccess(res, confirmedPayload(serviceId, transId, order));
  }
  if (["failed", "needs_review"].includes(order.state) || !isAutobuyEnabled()) {
    return sendFailure(res, serviceId, "10015", { transId, confirmTime: null });
  }

  try {
    order = await confirmAndWait(order._id);
  } catch (error) {
    console.error("Uzum confirm error:", order._id, error.message);
    return sendFailure(res, serviceId, "99999", { transId });
  }

  if (order?.state !== "confirmed") {
    return sendFailure(res, serviceId, "10015", { transId, confirmTime: null });
  }
  return sendSuccess(res, confirmedPayload(serviceId, transId, order));
}

async function status(req, res) {
  const serviceId = req.uzumServiceId;
  const transId = getTransId(req.body);
  if (!transId) return sendFailure(res, serviceId, "10005");

  const order = await UzumOrder.findOne({ transId, serviceId }).lean();
  if (!order || order.state !== "confirmed") {
    return sendFailure(res, serviceId, "10014", { transId });
  }

  return sendSuccess(res, {
    serviceId,
    transId,
    status: "CONFIRMED",
    transTime: toTimestamp(order.createdAt),
    confirmTime: toTimestamp(order.confirmedAt),
    reverseTime: null,
    data: {
      player_id: { value: order.playerId },
      profile_name: { value: order.profileName },
      amount: { value: String(order.priceUzs) },
    },
    amount: order.amountTiyin,
  });
}

module.exports = {
  catalog,
  check,
  create,
  confirm,
  status,
  getPlanCode,
  getPlayerId,
  getTransId,
  getPriceAmount,
  confirmedPayload,
};
