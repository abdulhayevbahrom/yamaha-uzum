const PubgPlan = require("../models/pubg-plan.model");
const { getPubgProducts } = require("./gw-api.service");

let syncPromise = null;
let syncTimer = null;

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function safeCode(providerProductId) {
  return `gw_${String(providerProductId || "")}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 80);
}

function getCatalogMaxAgeMs() {
  return Math.max(60_000, Number(process.env.GW_PUBG_CATALOG_MAX_AGE_MS || 30 * 60_000));
}

function isPlanReady(plan, now = Date.now()) {
  const syncedAt = new Date(plan?.providerSyncedAt || 0).getTime();
  return Boolean(
    plan &&
    plan.provider === "gw" &&
    plan.providerProductId &&
    plan.providerAvailable &&
    syncedAt > 0 &&
    now - syncedAt <= getCatalogMaxAgeMs(),
  );
}

async function performCatalogSync() {
  const products = await getPubgProducts();
  if (!products.length) throw new Error("GW PUBG katalogi bo'sh qaytdi");

  const uniqueProducts = new Map();
  for (const item of products) {
    const key = String(item.providerProductId).toUpperCase();
    if (uniqueProducts.has(key)) {
      throw new Error(`GW katalogida takroriy PID: ${item.providerProductId}`);
    }
    uniqueProducts.set(key, item);
  }

  const syncedAt = new Date();
  const seenIds = products.map((item) => item.providerProductId);
  await PubgPlan.updateMany(
    { providerProductId: { $nin: seenIds } },
    {
      $set: {
        providerAvailable: false,
        providerQuantity: 0,
        providerSyncedAt: syncedAt,
      },
    },
  );

  for (const item of products) {
    const existing = await PubgPlan.findOne({ providerProductId: item.providerProductId });
    const providerChanged =
      !existing ||
      Number(existing.providerPriceUsd || 0) !== Number(item.priceUsd) ||
      Boolean(existing.providerAvailable) !== Boolean(item.available) ||
      existing.providerQuantity !== item.stockQuantity;

    const providerFields = {
      label: item.label || `${item.amount} UC`,
      amount: item.amount,
      provider: "gw",
      providerProductId: item.providerProductId,
      providerPriceUsd: item.priceUsd,
      providerAvailable: item.available,
      providerQuantity: item.stockQuantity,
      providerSyncedAt: syncedAt,
    };
    if (providerChanged) providerFields.providerUpdatedAt = syncedAt;

    await PubgPlan.findOneAndUpdate(
      { providerProductId: item.providerProductId },
      {
        $set: providerFields,
        $setOnInsert: {
          code: safeCode(item.providerProductId),
          price: 0,
          isActive: false,
          configurationSource: "initial",
        },
      },
      { upsert: true, runValidators: true },
    );
  }

  return PubgPlan.find().sort({ amount: 1, createdAt: 1 }).lean();
}

async function syncCatalog() {
  if (syncPromise) return syncPromise;
  syncPromise = performCatalogSync();
  try {
    return await syncPromise;
  } finally {
    syncPromise = null;
  }
}

async function listActivePlans() {
  const plans = await PubgPlan.find({ isActive: true, price: { $gt: 0 } })
    .sort({ amount: 1, createdAt: 1 })
    .lean();
  return plans.filter((plan) => isPlanReady(plan));
}

async function findActivePlan(code) {
  const plan = await PubgPlan.findOne({
    code: String(code || "").trim(),
    isActive: true,
    price: { $gt: 0 },
  }).lean();
  return isPlanReady(plan) ? plan : null;
}

function startCatalogSync() {
  if (enabled(process.env.GW_PUBG_CATALOG_SYNC_ON_START)) {
    syncCatalog().catch((error) => console.error("GW catalog startup sync error:", error.message));
  }

  const intervalMs = Math.max(
    60_000,
    Number(process.env.GW_PUBG_CATALOG_SYNC_INTERVAL_MS || 5 * 60_000),
  );
  syncTimer = setInterval(() => {
    syncCatalog().catch((error) => console.error("GW catalog sync error:", error.message));
  }, intervalMs);
  syncTimer.unref?.();
}

function stopCatalogSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
}

module.exports = {
  syncCatalog,
  listActivePlans,
  findActivePlan,
  isPlanReady,
  safeCode,
  startCatalogSync,
  stopCatalogSync,
};
