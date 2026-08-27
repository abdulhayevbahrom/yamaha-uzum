const mongoose = require("mongoose");

async function connectDatabase() {
  const uri = String(process.env.MONGO_URI || "").trim();
  if (!uri) throw new Error("MONGO_URI topilmadi");

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
  });
  return mongoose.connection;
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = { connectDatabase, disconnectDatabase };
