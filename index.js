require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const { connectDatabase, disconnectDatabase } = require("./config/database");
const uzumPubgRoutes = require("./routes/uzum-pubg.routes");
const { startCatalogSync, stopCatalogSync } = require("./services/catalog.service");
const { startRecoveryWorker, stopRecoveryWorker } = require("./services/fulfillment.service");
const { startAdminBot, stopAdminBot } = require("./bot/admin-bot");
const { validateRuntimeConfig } = require("./scripts/preflight");

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", enabled(process.env.TRUST_PROXY));
  app.use(express.json({ limit: "128kb" }));

  app.get("/health", (_, res) => {
    res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({
      state: mongoose.connection.readyState === 1,
      service: "yamaha-uzum-pubg",
      database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    });
  });
  app.use("/api/uzum/pubg", uzumPubgRoutes);
  app.use((_, res) => {
    res.status(404).json({ state: false, message: "Endpoint topilmadi" });
  });
  return app;
}

async function start() {
  validateRuntimeConfig();
  await connectDatabase();

  const app = createApp();
  const port = Math.max(1, Number(process.env.PORT || 4100));
  const server = app.listen(port, () => {
    console.log(`Yamaha Uzum API port ${port} da ishga tushdi`);
  });

  startCatalogSync();
  startRecoveryWorker();
  await startAdminBot();

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: Yamaha Uzum to'xtatilmoqda`);
    stopCatalogSync();
    stopRecoveryWorker();
    await stopAdminBot();
    await new Promise((resolve) => server.close(resolve));
    await disconnectDatabase();
    process.exit(0);
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  return server;
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Yamaha Uzum startup error:", error.message);
    process.exit(1);
  });
}

module.exports = { createApp, start };
