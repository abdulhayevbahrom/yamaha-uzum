require("dotenv").config();

function normalize(value) {
  return String(value || "").trim();
}

function validateRuntimeConfig() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 18) {
    throw new Error("Node.js 18 yoki undan yangi versiya kerak");
  }

  const required = [
    "MONGO_URI",
    "UZUM_PUBG_SERVICE_IDS",
    "UZUM_PUBG_LOGIN",
    "UZUM_PUBG_PASSWORD",
    "GW_API_KEY",
    "UZUM_ADMIN_BOT_TOKEN",
    "UZUM_ADMIN_TG_IDS",
  ];
  const missing = required.filter((key) => !normalize(process.env[key]));
  if (missing.length) throw new Error(`Majburiy env topilmadi: ${missing.join(", ")}`);

  const serviceIds = normalize(process.env.UZUM_PUBG_SERVICE_IDS)
    .split(",")
    .map((item) => Number(item.trim()));
  if (!serviceIds.length || serviceIds.some((item) => !Number.isInteger(item) || item <= 0)) {
    throw new Error("UZUM_PUBG_SERVICE_IDS noto'g'ri");
  }

  const gwUrl = new URL(normalize(process.env.GW_API_URL) || "https://api.sonofutred.com");
  if (gwUrl.protocol !== "https:") throw new Error("GW_API_URL HTTPS bo'lishi kerak");
  if (normalize(process.env.UZUM_PUBG_PASSWORD) === "change-me") {
    throw new Error("UZUM_PUBG_PASSWORD almashtirilmagan");
  }
  return true;
}

if (require.main === module) {
  try {
    validateRuntimeConfig();
    console.log("Yamaha Uzum preflight muvaffaqiyatli");
  } catch (error) {
    console.error(`Preflight xatolik: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { validateRuntimeConfig };
