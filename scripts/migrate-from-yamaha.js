require("dotenv").config();

const mongoose = require("mongoose");
const { connectDatabase, disconnectDatabase } = require("../config/database");
const PubgPlan = require("../models/pubg-plan.model");
const UzumOrder = require("../models/uzum-order.model");

function normalize(value) {
  return String(value || "").trim();
}

function firstServiceId() {
  return Number(
    normalize(process.env.UZUM_PUBG_SERVICE_IDS)
      .split(",")
      .map((item) => item.trim())
      .find(Boolean) || 0,
  );
}

function mapOrderState(order) {
  if (order?.status === "completed" && order?.fulfillmentStatus === "success") {
    return { state: "confirmed", phase: "completed" };
  }
  if (["cancelled", "failed"].includes(String(order?.status || ""))) {
    return { state: "failed", phase: "failed" };
  }
  if (order?.fulfillmentStatus === "needs_review") {
    return { state: "needs_review", phase: "polling" };
  }
  if (order?.fulfillmentStatus === "processing") {
    return {
      state: "processing",
      phase: order?.fragmentTx?.providerOrderId ? "polling" : "submit_unknown",
    };
  }
  return { state: "created", phase: "created" };
}

async function migratePlans(sourceDb) {
  const [sourcePlans, sourceConfigs] = await Promise.all([
    sourceDb.collection("plans").find({ category: "uc" }).toArray(),
    sourceDb.collection("uzumpubgplans").find().toArray(),
  ]);
  const plansByCode = new Map(sourcePlans.map((plan) => [normalize(plan.code), plan]));
  const configs = sourceConfigs.length
    ? sourceConfigs
    : sourcePlans
      .filter((plan) => plan.provider === "gw" && Number(plan.basePrice || 0) > 0)
      .map((plan) => ({
        planCode: plan.code,
        price: plan.basePrice,
        isActive: plan.isActive,
      }));
  let migrated = 0;
  let skipped = 0;

  for (const config of configs) {
    const plan = plansByCode.get(normalize(config.planCode));
    if (!plan?.providerProductId) {
      skipped += 1;
      continue;
    }

    const existing = await PubgPlan.findOne({
      $or: [
        { providerProductId: normalize(plan.providerProductId) },
        { code: normalize(plan.code) },
      ],
    });
    const canImportConfiguration =
      !existing || !existing.configurationSource || existing.configurationSource === "initial";
    const providerFields = {
      label: normalize(plan.label) || `${Number(plan.amount || 0)} UC`,
      amount: Math.max(0, Number(plan.amount || 0)),
      provider: "gw",
      providerProductId: normalize(plan.providerProductId),
      providerPriceUsd: Math.max(0, Number(plan.providerPriceUsd || 0)),
      providerAvailable: Boolean(plan.providerAvailable),
      providerQuantity: plan.providerQuantity ?? null,
      providerSyncedAt: plan.providerSyncedAt || null,
      providerUpdatedAt: plan.providerUpdatedAt || null,
    };
    if (canImportConfiguration) {
      Object.assign(providerFields, {
        code: normalize(plan.code),
        price: Math.max(0, Math.round(Number(config.price || 0))),
        isActive: Boolean(config.isActive) && Number(config.price || 0) > 0,
        configurationSource: "migration",
      });
    }

    if (existing) {
      await PubgPlan.updateOne({ _id: existing._id }, { $set: providerFields });
    } else {
      await PubgPlan.create(providerFields);
    }
    migrated += 1;
  }

  return { migrated, skipped, plansByCode };
}

async function migrateOrders(sourceDb, plansByCode) {
  const sourceOrders = await sourceDb.collection("orders").find({
    paymentMethod: "uzumbank",
    paymentEventKey: { $exists: true, $ne: "" },
  }).toArray();
  const serviceId = firstServiceId();
  let migrated = 0;
  let updated = 0;

  for (const order of sourceOrders) {
    const transId = normalize(order.paymentEventKey || order?.fragmentTx?.transId);
    if (!transId) continue;
    const sourcePlan = plansByCode.get(normalize(order.planCode));
    const mappedState = mapOrderState(order);
    const priceUzs = Math.max(0, Math.round(Number(order.expectedAmount || order.paidAmount || 0)));
    const confirmedAt = order.fulfilledAt || order?.fragmentTx?.completedAt || null;
    const failedAt = mappedState.state === "failed" ? order.fulfilledAt || order.updatedAt : null;
    const providerTrxId = normalize(
      order?.fragmentTx?.trxid ||
      (order.orderId ? `YMH-PUBG-${order.orderId}` : `YUZ-LEGACY-${order._id}`),
    );
    const existing = await UzumOrder.findOne({ transId }).lean();
    if (existing) {
      const sourceIsTerminal = ["confirmed", "failed"].includes(mappedState.state);
      const targetCanAdvance = existing.state !== "confirmed";
      if (
        sourceIsTerminal &&
        targetCanAdvance &&
        normalize(existing.sourceOrderId) === String(order._id)
      ) {
        await UzumOrder.updateOne(
          { _id: existing._id, state: { $ne: "confirmed" } },
          {
            $set: {
              state: mappedState.state,
              phase: mappedState.phase,
              providerOrderId: normalize(order?.fragmentTx?.providerOrderId),
              providerStatus: normalize(order?.fragmentTx?.providerStatus),
              providerResponse: order?.fragmentTx?.response || null,
              lastError: normalize(order.fulfillmentError),
              confirmedAt,
              failedAt,
              lockToken: "",
              lockUntil: null,
            },
          },
        );
        updated += 1;
      }
      continue;
    }

    const result = await UzumOrder.collection.updateOne(
      { transId },
      {
        $setOnInsert: {
          serviceId,
          transId,
          playerId: normalize(order.playerId || order.username),
          profileName: normalize(order.profileName) || `Player ID: ${normalize(order.playerId || order.username)}`,
          planCode: normalize(order.planCode),
          planLabel: normalize(sourcePlan?.label) || normalize(order.planCode),
          priceUzs,
          amountTiyin: priceUzs * 100,
          providerProductId: normalize(
            order?.fragmentTx?.providerProductId || sourcePlan?.providerProductId || "legacy-unknown",
          ),
          providerTrxId,
          providerOrderId: normalize(order?.fragmentTx?.providerOrderId),
          providerStatus: normalize(order?.fragmentTx?.providerStatus),
          providerResponse: order?.fragmentTx?.response || null,
          state: mappedState.state,
          phase: mappedState.phase,
          submitAttempts: Number(order?.fragmentTx?.submitRecoveryAttempts || 0),
          pollAttempts: Number(order?.fragmentTx?.pollAttempts || 0),
          lastError: normalize(order.fulfillmentError),
          confirmStartedAt: order.fulfillmentStartedAt || null,
          confirmedAt,
          failedAt,
          lastProviderCheckAt: order?.fragmentTx?.updatedAt || null,
          lockToken: "",
          lockUntil: null,
          sourceOrderId: String(order._id),
          createdAt: order.createdAt || new Date(),
          updatedAt: order.updatedAt || new Date(),
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount > 0) migrated += 1;
  }

  return { migrated, updated, found: sourceOrders.length };
}

async function run() {
  const sourceUri = normalize(process.env.SOURCE_MONGO_URI);
  const targetUri = normalize(process.env.MONGO_URI);
  if (!sourceUri) throw new Error("SOURCE_MONGO_URI topilmadi");
  if (!targetUri) throw new Error("MONGO_URI topilmadi");
  if (sourceUri === targetUri) {
    throw new Error("SOURCE_MONGO_URI va MONGO_URI alohida bo'lishi kerak");
  }
  if (!firstServiceId()) throw new Error("UZUM_PUBG_SERVICE_IDS topilmadi");

  await connectDatabase();
  const sourceConnection = await mongoose.createConnection(sourceUri, {
    serverSelectionTimeoutMS: 10_000,
  }).asPromise();
  try {
    const planResult = await migratePlans(sourceConnection.db);
    const orderResult = await migrateOrders(sourceConnection.db, planResult.plansByCode);
    console.log(
      `Migratsiya yakunlandi: paketlar=${planResult.migrated}, ` +
      `paket_skip=${planResult.skipped}, orderlar_yangi=${orderResult.migrated}, ` +
      `orderlar_yangilandi=${orderResult.updated}, jami=${orderResult.found}`,
    );
  } finally {
    await sourceConnection.close();
    await disconnectDatabase();
  }
}

if (require.main === module) {
  run().catch(async (error) => {
    console.error("Yamaha Uzum migratsiya xatosi:", error.message);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
}

module.exports = { mapOrderState, migratePlans, migrateOrders };
