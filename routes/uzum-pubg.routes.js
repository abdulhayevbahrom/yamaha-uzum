const router = require("express").Router();
const controller = require("../controllers/uzum-pubg.controller");
const { requireUzumAuth } = require("../middleware/uzum-auth.middleware");
const { sendFailure } = require("../utils/uzum-response");

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

router.use(requireUzumAuth);
router.post("/catalog", asyncHandler(controller.catalog));
router.post("/check", asyncHandler(controller.check));
router.post("/create", asyncHandler(controller.create));
router.post("/confirm", asyncHandler(controller.confirm));
router.post("/status", asyncHandler(controller.status));
router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error("Uzum API unhandled error:", error.message);
  return sendFailure(res, req.uzumServiceId || Number(req.body?.serviceId || 0), "99999");
});

module.exports = router;
