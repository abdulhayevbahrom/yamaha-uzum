const mongoose = require("mongoose");

const pubgPlanSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    price: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    provider: {
      type: String,
      enum: ["gw"],
      default: "gw",
    },
    providerProductId: {
      type: String,
      required: true,
      trim: true,
    },
    providerPriceUsd: {
      type: Number,
      default: 0,
      min: 0,
    },
    providerAvailable: {
      type: Boolean,
      default: false,
    },
    providerQuantity: {
      type: Number,
      default: null,
      min: 0,
    },
    providerSyncedAt: {
      type: Date,
      default: null,
    },
    providerUpdatedAt: {
      type: Date,
      default: null,
    },
    configurationSource: {
      type: String,
      enum: ["initial", "migration", "bot"],
      default: "initial",
    },
  },
  { timestamps: true },
);

pubgPlanSchema.index({ providerProductId: 1 }, { unique: true });
pubgPlanSchema.index({ isActive: 1, amount: 1 });

module.exports = mongoose.model("PubgPlan", pubgPlanSchema);
