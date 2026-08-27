const crypto = require("node:crypto");
const { sendFailure } = require("../utils/uzum-response");

function normalize(value) {
  return String(value || "").trim();
}

function parseServiceIds(value = process.env.UZUM_PUBG_SERVICE_IDS) {
  return normalize(value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function decodeBasicAuth(headerValue) {
  const header = normalize(headerValue);
  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) return null;

  try {
    const raw = Buffer.from(match[1], "base64").toString("utf8");
    const separator = raw.indexOf(":");
    if (separator <= 0) return null;
    const login = raw.slice(0, separator);
    const password = raw.slice(separator + 1);
    if (!login || !password) return null;
    return { login, password };
  } catch (_) {
    return null;
  }
}

function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireUzumAuth(req, res, next) {
  const serviceId = Number(req.body?.serviceId || 0);
  if (!parseServiceIds().includes(serviceId)) {
    return sendFailure(res, serviceId || req.body?.serviceId, "10006");
  }

  const credentials = decodeBasicAuth(req.headers.authorization);
  const expectedLogin = normalize(process.env.UZUM_PUBG_LOGIN);
  const expectedPassword = normalize(process.env.UZUM_PUBG_PASSWORD);
  if (
    !credentials ||
    !expectedLogin ||
    !expectedPassword ||
    !safeEqual(credentials.login, expectedLogin) ||
    !safeEqual(credentials.password, expectedPassword)
  ) {
    return sendFailure(res, serviceId, "10001");
  }

  req.uzumServiceId = serviceId;
  return next();
}

module.exports = {
  requireUzumAuth,
  decodeBasicAuth,
  parseServiceIds,
  safeEqual,
};
