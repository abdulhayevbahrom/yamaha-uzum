const mongoose = require("mongoose");

const uzumOrderSchema = new mongoose.Schema(
  {
    serviceId: {
      type: Number,
      required: true,
      index: true,
    },
    transId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    playerId: {
      type: String,
      required: true,
      trim: true,
    },
    profileName: {
      type: String,
      required: true,
      trim: true,
    },
    planCode: {
      type: String,
      required: true,
      trim: true,
    },
    planLabel: {
      type: String,
      required: true,
      trim: true,
    },
    priceUzs: {
      type: Number,
      required: true,
      min: 0,
    },
    amountTiyin: {
      type: Number,
      required: true,
      min: 0,
    },
    providerProductId: {
      type: String,
      required: true,
      trim: true,
    },
    providerTrxId: {
      type: String,
      default: "",
      trim: true,
    },
    providerOrderId: {
      type: String,
      default: "",
      trim: true,
    },
    providerStatus: {
      type: String,
      default: "",
      trim: true,
    },
    providerResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    state: {
      type: String,
      enum: ["created", "processing", "confirmed", "failed", "needs_review"],
      default: "created",
      index: true,
    },
    phase: {
      type: String,
      enum: ["created", "submit_started", "submit_unknown", "polling", "completed", "failed"],
      default: "created",
    },
    submitAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    pollAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastError: {
      type: String,
      default: "",
    },
    confirmStartedAt: {
      type: Date,
      default: null,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    gwBalanceAlertCheckedAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    lastProviderCheckAt: {
      type: Date,
      default: null,
    },
    lockToken: {
      type: String,
      default: "",
    },
    lockUntil: {
      type: Date,
      default: null,
    },
    sourceOrderId: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

uzumOrderSchema.index({ state: 1, lockUntil: 1, updatedAt: 1 });
uzumOrderSchema.index({ createdAt: -1 });

module.exports = mongoose.model("UzumOrder", uzumOrderSchema);
