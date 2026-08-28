const axios = require("axios");
const https = require("node:https");

const DEFAULT_BASE_URL = "https://api.sonofutred.com";
const PUBG_GROWTH_PACK_AMOUNTS = new Map([
  ["GWPSFP", 1],
  ["GWPSMP", 2],
  ["GWPSMYTH", 3],
  ["GWWEMBLM", 4],
]);

function normalize(value) {
  return String(value || "").trim();
}

function getConfig() {
  const apiKey = normalize(process.env.GW_API_KEY);
  if (!apiKey) throw new Error("GW_API_KEY topilmadi");

  const parsedUrl = new URL(normalize(process.env.GW_API_URL) || DEFAULT_BASE_URL);
  if (parsedUrl.protocol !== "https:") {
    throw new Error("GW_API_URL HTTPS bo'lishi kerak");
  }

  return {
    apiKey,
    baseURL: parsedUrl.href.replace(/\/+$/, ""),
    timeout: Math.max(3_000, Number(process.env.GW_API_TIMEOUT_MS || 20_000)),
  };
}

function createClient() {
  const config = getConfig();
  return axios.create({
    baseURL: config.baseURL,
    timeout: config.timeout,
    httpsAgent: new https.Agent({ family: 4 }),
    headers: {
      "X-API-Key": config.apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
}

function unwrapProducts(payload) {
  const rows =
    payload?.products ||
    payload?.data?.products ||
    payload?.innerData?.products ||
    (Array.isArray(payload?.data) ? payload.data : null) ||
    (Array.isArray(payload?.innerData) ? payload.innerData : null);
  return Array.isArray(rows) ? rows : [];
}

function isPubgTopup(item) {
  const providerProductId = normalize(item?.id || item?.pid || item?.PID).toUpperCase();
  if (PUBG_GROWTH_PACK_AMOUNTS.has(providerProductId)) return true;
  const text = [item?.slug, item?.gameName, item?.serviceName, item?.category]
    .map((value) => normalize(value).toLowerCase())
    .join(" ");
  return (
    text.includes("pubg") &&
    !text.includes("gamekey") &&
    !text.includes("giftcard") &&
    !text.includes("code")
  );
}

function extractAmount(item) {
  const candidates = [
    item?.serviceName,
    item?.service?.name,
    item?.product?.name,
    item?.name,
    item?.label,
    item?.title,
    item?.amount,
  ];
  for (const candidate of candidates) {
    const match = normalize(candidate).match(/\d[\d,]*/);
    if (match) return Number(match[0].replace(/,/g, ""));
  }
  return 0;
}

function normalizeProduct(item) {
  const providerProductId = normalize(item?.id || item?.pid || item?.PID);
  const amount = extractAmount(item) || PUBG_GROWTH_PACK_AMOUNTS.get(providerProductId.toUpperCase()) || 0;
  const priceUsd = Number(item?.price || item?.priceUsd || item?.usdPrice || item?.cost || 0);
  const rawQuantity = item?.quantity ?? item?.stock ?? item?.availableQuantity;
  const quantity = rawQuantity === undefined || rawQuantity === null || rawQuantity === ""
    ? null
    : Number(rawQuantity);
  const stockQuantity = Number.isFinite(quantity) && quantity >= 0 ? Math.floor(quantity) : null;
  return {
    providerProductId,
    amount,
    code: amount > 0 ? String(amount) : providerProductId,
    label: normalize(
      item?.serviceName ||
      item?.service?.name ||
      item?.product?.name ||
      item?.name ||
      item?.label ||
      item?.title ||
      `${amount} UC`,
    ),
    priceUsd: Number.isFinite(priceUsd) ? priceUsd : 0,
    stockQuantity,
    available:
      Number.isFinite(priceUsd) &&
      priceUsd > 0 &&
      normalize(item?.status).toLowerCase() !== "inactive" &&
      item?.inStock !== false,
  };
}

async function getPubgProducts() {
  const response = await createClient().get("/products");
  return unwrapProducts(response.data)
    .filter(isPubgTopup)
    .map(normalizeProduct)
    .filter((item) => item.providerProductId && item.amount > 0 && item.priceUsd > 0);
}

async function verifyPubgPlayer(playerId, trxid) {
  const response = await createClient().post("/pubgvvfy", { playerId, trxid });
  return response.data;
}

async function createOrder(body) {
  const response = await createClient().post("/orders", body);
  return response.data;
}

async function getBalance() {
  const response = await createClient().get("/balance");
  return response.data;
}

async function getOrder(orderId) {
  const response = await createClient().get(`/orders/${encodeURIComponent(orderId)}`);
  return response.data;
}

module.exports = {
  getPubgProducts,
  verifyPubgPlayer,
  getBalance,
  createOrder,
  getOrder,
  isPubgTopup,
  normalizeProduct,
};
