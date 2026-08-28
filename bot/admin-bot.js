const { Api, longPoll } = require("node-telegram-bot-api");
const PubgPlan = require("../models/pubg-plan.model");
const UzumOrder = require("../models/uzum-order.model");
const { syncCatalog, isPlanReady } = require("../services/catalog.service");
const { getBalance } = require("../services/gw-api.service");

const BUTTONS = {
  plans: "PUBG paketlari",
  sync: "GW katalogni yangilash",
  orders: "Oxirgi buyurtmalar",
  status: "Servis holati",
  balance: "GW balans",
};
const PAGE_SIZE = 8;

let bot = null;
let pollingAbortController = null;
let pollingPromise = null;
const pendingPriceInput = new Map();

function normalize(value) {
  return String(value || "").trim();
}

function parseAdminIds(value = process.env.UZUM_ADMIN_TG_IDS) {
  return new Set(
    normalize(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function isAdmin(userId) {
  return parseAdminIds().has(String(userId || ""));
}

function formatPrice(value) {
  return `${Math.max(0, Number(value || 0)).toLocaleString("en-US")} UZS`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function menuMarkup() {
  return {
    keyboard: [
      [{ text: BUTTONS.plans }, { text: BUTTONS.orders }],
      [{ text: BUTTONS.sync }, { text: BUTTONS.status }],
      [{ text: BUTTONS.balance }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

async function sendMenu(chatId) {
  return bot.sendMessage(
    chatId,
    "Yamaha Uzum boshqaruvi. Kerakli bo'limni tanlang.",
    { reply_markup: menuMarkup() },
  );
}

async function deny(chatId) {
  if (chatId) await bot.sendMessage(chatId, "Bu bot faqat ruxsat berilgan adminlar uchun.");
}

function clampPage(page, totalPages) {
  return Math.min(Math.max(0, Number(page) || 0), Math.max(0, totalPages - 1));
}

async function plansView(page = 0) {
  const total = await PubgPlan.countDocuments();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = clampPage(page, totalPages);
  const plans = await PubgPlan.find()
    .sort({ amount: 1, createdAt: 1 })
    .skip(safePage * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .lean();

  const rows = plans.map((plan) => [{
    text: `${plan.isActive ? "ON" : "OFF"} | ${plan.label} | ${formatPrice(plan.price)}`,
    callback_data: `plan:${plan._id}:${safePage}`,
  }]);
  const navigation = [];
  if (safePage > 0) navigation.push({ text: "Oldingi", callback_data: `plans:${safePage - 1}` });
  if (safePage + 1 < totalPages) navigation.push({ text: "Keyingi", callback_data: `plans:${safePage + 1}` });
  if (navigation.length) rows.push(navigation);
  rows.push([{ text: "GW katalogni yangilash", callback_data: "sync" }]);

  return {
    text: `PUBG paketlari: ${total} ta\nSahifa: ${safePage + 1}/${totalPages}`,
    options: { reply_markup: { inline_keyboard: rows } },
  };
}

function planText(plan) {
  const ready = isPlanReady(plan);
  return [
    `<b>${escapeHtml(plan.label)}</b>`,
    `Code: <code>${escapeHtml(plan.code)}</code>`,
    `Uzum narxi: <b>${escapeHtml(formatPrice(plan.price))}</b>`,
    `Uzum holati: <b>${plan.isActive ? "faol" : "nofaol"}</b>`,
    `GW PID: <code>${escapeHtml(plan.providerProductId)}</code>`,
    `GW narxi: ${Number(plan.providerPriceUsd || 0).toFixed(2)} USD`,
    `GW holati: <b>${ready ? "tayyor" : "mavjud emas yoki katalog eskirgan"}</b>`,
  ].join("\n");
}

function planMarkup(plan, page) {
  return {
    inline_keyboard: [
      [{
        text: plan.isActive ? "Uzumda o'chirish" : "Uzumda yoqish",
        callback_data: `toggle:${plan._id}:${page}`,
      }],
      [{ text: "Narxni o'zgartirish", callback_data: `price:${plan._id}:${page}` }],
      [{ text: "Paketlarga qaytish", callback_data: `plans:${page}` }],
    ],
  };
}

async function sendOrEdit(query, text, options = {}) {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  if (chatId && messageId) {
    try {
      return await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...options,
      });
    } catch (error) {
      if (String(error?.message || "").includes("message is not modified")) return null;
    }
  }
  return bot.sendMessage(chatId, text, options);
}

async function answerCallback(query, text = "", showAlert = false) {
  try {
    await bot.answerCallbackQuery(query.id, { text, show_alert: showAlert });
  } catch (_) {
    // Telegram may expire callback queries while a GW sync is running.
  }
}

async function showPlans(query, page) {
  const view = await plansView(page);
  await sendOrEdit(query, view.text, view.options);
}

async function showPlan(query, planId, page) {
  const plan = await PubgPlan.findById(planId).lean();
  if (!plan) return answerCallback(query, "Paket topilmadi", true);
  await sendOrEdit(query, planText(plan), {
    parse_mode: "HTML",
    reply_markup: planMarkup(plan, page),
  });
}

async function togglePlan(query, planId, page) {
  const plan = await PubgPlan.findById(planId);
  if (!plan) return answerCallback(query, "Paket topilmadi", true);
  const nextActive = !plan.isActive;
  if (nextActive && Number(plan.price || 0) <= 0) {
    return answerCallback(query, "Avval Uzum narxini kiriting", true);
  }
  if (nextActive && !isPlanReady(plan)) {
    return answerCallback(query, "GW paketi hozir sotuvga tayyor emas", true);
  }

  plan.isActive = nextActive;
  plan.configurationSource = "bot";
  await plan.save();
  await answerCallback(query, nextActive ? "Paket Uzumda yoqildi" : "Paket Uzumda o'chirildi");
  await showPlan(query, planId, page);
}

async function requestPrice(query, planId, page) {
  const plan = await PubgPlan.findById(planId).lean();
  if (!plan) return answerCallback(query, "Paket topilmadi", true);
  const userId = String(query.from?.id || "");
  pendingPriceInput.set(userId, {
    planId: String(plan._id),
    page,
    expiresAt: Date.now() + 5 * 60_000,
  });
  await answerCallback(query, "Narxni xabar qilib yuboring");
  await bot.sendMessage(
    query.message.chat.id,
    `${plan.label} uchun yangi Uzum narxini butun UZS ko'rinishida yuboring. Masalan: 13000`,
    { reply_markup: { force_reply: true, selective: true } },
  );
}

function parsePrice(text) {
  const normalized = normalize(text).replace(/[\s,]/g, "");
  if (!/^\d+$/.test(normalized)) return null;
  const price = Number(normalized);
  return Number.isSafeInteger(price) && price >= 0 ? price : null;
}

async function savePendingPrice(msg) {
  const userId = String(msg.from?.id || "");
  const pending = pendingPriceInput.get(userId);
  if (!pending) return false;
  pendingPriceInput.delete(userId);
  if (pending.expiresAt < Date.now()) {
    await bot.sendMessage(msg.chat.id, "Narx kiritish vaqti tugadi. Qayta urinib ko'ring.");
    return true;
  }

  const price = parsePrice(msg.text);
  if (price === null) {
    await bot.sendMessage(msg.chat.id, "Narx noto'g'ri. Faqat butun UZS summasini kiriting.");
    return true;
  }

  const update = { price, configurationSource: "bot" };
  if (price === 0) update.isActive = false;
  const plan = await PubgPlan.findByIdAndUpdate(pending.planId, { $set: update }, { new: true }).lean();
  if (!plan) {
    await bot.sendMessage(msg.chat.id, "Paket topilmadi.");
    return true;
  }

  await bot.sendMessage(
    msg.chat.id,
    `${plan.label} Uzum narxi ${formatPrice(plan.price)} qilib saqlandi.${price === 0 ? " Paket o'chirildi." : ""}`,
  );
  await bot.sendMessage(msg.chat.id, planText(plan), {
    parse_mode: "HTML",
    reply_markup: planMarkup(plan, pending.page),
  });
  return true;
}

async function syncFromBot(chatId, query = null) {
  if (query) await answerCallback(query, "GW katalog yangilanmoqda");
  const waiting = await bot.sendMessage(chatId, "GW PUBG katalogi yangilanmoqda...");
  try {
    const plans = await syncCatalog();
    await bot.editMessageText(`GW katalog yangilandi. ${plans.length} ta paket topildi.`, {
      chat_id: chatId,
      message_id: waiting.message_id,
    });
  } catch (error) {
    await bot.editMessageText(`GW katalogni yangilashda xatolik: ${normalize(error.message)}`, {
      chat_id: chatId,
      message_id: waiting.message_id,
    });
  }
}

async function showOrders(chatId) {
  const orders = await UzumOrder.find()
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  if (!orders.length) {
    await bot.sendMessage(chatId, "Hali Uzum buyurtmalari yo'q.");
    return;
  }

  const lines = orders.map((order) => [
    `<code>${escapeHtml(order.transId)}</code>`,
    `${escapeHtml(order.planLabel)} | ${escapeHtml(formatPrice(order.priceUzs))}`,
    `Player: <code>${escapeHtml(order.playerId)}</code>`,
    `Holat: <b>${escapeHtml(order.state)}</b>`,
  ].join("\n"));
  await bot.sendMessage(chatId, lines.join("\n\n"), { parse_mode: "HTML" });
}

async function showStatus(chatId) {
  const [totalPlans, activePlans, createdOrders, processingOrders, confirmedOrders] = await Promise.all([
    PubgPlan.countDocuments(),
    PubgPlan.countDocuments({ isActive: true, price: { $gt: 0 } }),
    UzumOrder.countDocuments({ state: "created" }),
    UzumOrder.countDocuments({ state: "processing" }),
    UzumOrder.countDocuments({ state: "confirmed" }),
  ]);
  await bot.sendMessage(chatId, [
    "Yamaha Uzum servis holati",
    `Paketlar: ${totalPlans}`,
    `Uzumda faol: ${activePlans}`,
    `Create qilingan: ${createdOrders}`,
    `Jarayonda: ${processingOrders}`,
    `Tasdiqlangan: ${confirmedOrders}`,
  ].join("\n"));
}

async function showGwBalance(chatId) {
  const payload = await getBalance();
  const balanceUsd = Number(payload?.balanceUsd);
  if (!payload?.success || !Number.isFinite(balanceUsd)) {
    throw new Error("GW balans javobi noto'g'ri");
  }
  await bot.sendMessage(
    chatId,
    `💳 GW balansi: $${balanceUsd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
  );
}

async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  if (!chatId) return;
  if (!isAdmin(userId)) return deny(chatId);
  if (await savePendingPrice(msg)) return;

  const text = normalize(msg.text);
  if (/^\/start(?:\s|$)/.test(text) || text === "/menu") return sendMenu(chatId);
  if (text === BUTTONS.plans) {
    const view = await plansView(0);
    return bot.sendMessage(chatId, view.text, view.options);
  }
  if (text === BUTTONS.sync) return syncFromBot(chatId);
  if (text === BUTTONS.orders) return showOrders(chatId);
  if (text === BUTTONS.status) return showStatus(chatId);
  if (text === BUTTONS.balance || /^\/balans(?:@\w+)?(?:\s|$)/i.test(text)) {
    return showGwBalance(chatId);
  }
  return sendMenu(chatId);
}

async function handleCallback(query) {
  const chatId = query.message?.chat?.id;
  if (!chatId) return;
  if (!isAdmin(query.from?.id)) return answerCallback(query, "Ruxsat yo'q", true);

  const data = normalize(query.data);
  if (data === "sync") return syncFromBot(chatId, query);

  let match = data.match(/^plans:(\d+)$/);
  if (match) {
    await answerCallback(query);
    return showPlans(query, Number(match[1]));
  }
  match = data.match(/^plan:([a-f\d]{24}):(\d+)$/i);
  if (match) {
    await answerCallback(query);
    return showPlan(query, match[1], Number(match[2]));
  }
  match = data.match(/^toggle:([a-f\d]{24}):(\d+)$/i);
  if (match) return togglePlan(query, match[1], Number(match[2]));
  match = data.match(/^price:([a-f\d]{24}):(\d+)$/i);
  if (match) return requestPrice(query, match[1], Number(match[2]));
  return answerCallback(query, "Noma'lum amal", true);
}

function safeHandler(name, handler) {
  return async (...args) => {
    try {
      await handler(...args);
    } catch (error) {
      console.error(`Admin bot ${name} error:`, error.message);
      const chatId = args[0]?.chat?.id || args[0]?.message?.chat?.id;
      if (chatId) {
        await bot.sendMessage(chatId, "Amalni bajarishda xatolik yuz berdi.").catch(() => {});
      }
    }
  };
}

async function startAdminBot() {
  if (bot) return bot;
  const token = normalize(process.env.UZUM_ADMIN_BOT_TOKEN);
  if (!token) throw new Error("UZUM_ADMIN_BOT_TOKEN topilmadi");

  const api = new Api(token);
  bot = {
    sendMessage: (chatId, text, options = {}) => api.sendMessage({
      chat_id: chatId,
      text,
      ...options,
    }),
    editMessageText: (text, options = {}) => api.editMessageText({
      text,
      ...options,
    }),
    answerCallbackQuery: (callbackQueryId, options = {}) => api.answerCallbackQuery({
      callback_query_id: callbackQueryId,
      ...options,
    }),
  };

  pollingAbortController = new AbortController();
  pollingPromise = (async () => {
    for await (const update of longPoll(
      api,
      {
        timeout: 30,
        retry: true,
        allowedUpdates: ["message", "callback_query"],
        onError: (error) => console.error("Admin bot polling error:", error.message),
      },
      pollingAbortController.signal,
    )) {
      if (update.message) await safeHandler("message", handleMessage)(update.message);
      if (update.callback_query) {
        await safeHandler("callback", handleCallback)(update.callback_query);
      }
    }
  })().catch((error) => {
    if (!pollingAbortController?.signal.aborted) {
      console.error("Admin bot polling stopped:", error.message);
    }
  });

  const me = await api.getMe();
  console.log(`Uzum admin bot ishga tushdi: @${me.username}`);
  return bot;
}

async function stopAdminBot() {
  if (!bot) return;
  bot = null;
  pollingAbortController?.abort();
  await pollingPromise?.catch(() => {});
  pollingAbortController = null;
  pollingPromise = null;
}

module.exports = {
  startAdminBot,
  stopAdminBot,
  parseAdminIds,
  parsePrice,
  isAdmin,
};
