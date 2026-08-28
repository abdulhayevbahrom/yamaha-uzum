const axios = require("axios");
const { getBalance } = require("./gw-api.service");

const THRESHOLDS = [20, 50, 100];

function normalize(value) {
  return String(value || "").trim();
}

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(normalize(value).toLowerCase());
}

function pickThreshold(balanceUsd) {
  return THRESHOLDS.find((threshold) => balanceUsd <= threshold) || null;
}

function formatAlert(balanceUsd, threshold) {
  return [
    "⚠️ GW balans ogohlantirishi",
    `Joriy balans: $${balanceUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `Ogohlantirish chegarasi: $${threshold}`,
    "GW hisobini to'ldirish tavsiya etiladi.",
  ].join("\n");
}

async function checkGwBalanceAfterSale(orderId) {
  if (!enabled(process.env.GW_BALANCE_ALERT_ENABLED)) return { skipped: true, reason: "disabled" };

  const chatId = normalize(process.env.GW_BALANCE_ALERT_TARGET_CHAT_ID);
  const token = normalize(process.env.GW_BALANCE_ALERT_BOT_TOKEN || process.env.UZUM_ADMIN_BOT_TOKEN);
  if (!chatId || !token) return { skipped: true, reason: "telegram_not_configured" };

  const payload = await getBalance();
  const balanceUsd = Number(payload?.balanceUsd);
  if (!payload?.success || !Number.isFinite(balanceUsd) || balanceUsd < 0) {
    throw new Error("GW balans javobi noto'g'ri");
  }

  const threshold = pickThreshold(balanceUsd);
  if (!threshold) return { ok: true, balanceUsd, notified: false };

  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text: formatAlert(balanceUsd, threshold),
  }, { timeout: 15_000 });
  return { ok: true, balanceUsd, notified: true, threshold, orderId: String(orderId) };
}

module.exports = { checkGwBalanceAfterSale };
