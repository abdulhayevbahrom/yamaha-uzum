function sendFailure(res, serviceId, errorCode, extra = {}) {
  const normalizedCode = String(errorCode || "99999");
  const httpStatus = normalizedCode === "99999" ? 500 : 400;
  return res.status(httpStatus).json({
    serviceId,
    timestamp: Date.now(),
    status: "FAILED",
    errorCode: normalizedCode,
    ...extra,
  });
}

function sendSuccess(res, payload) {
  return res.status(200).json(payload);
}

function toTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

module.exports = { sendFailure, sendSuccess, toTimestamp };
