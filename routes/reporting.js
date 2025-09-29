const express = require("express");
const { getReportingByProduct, getEnrollments, getSettings, updateSettings, downloadReportingFile } = require("../controllers/reportingController");
const router = express.Router();

router.get("/settings", getSettings);
router.post("/settings", updateSettings);
router.get("/enrollments", getEnrollments);
router.get("/download", downloadReportingFile);
router.get("/:id", getReportingByProduct);

module.exports = router;
