// routes/api.js
import express from "express";
import { requireSuperadmin } from "../middlewares/index.js";

const router = express.Router();

// /api/inspections/analyze → POST
router.post("/inspections/analyze", (req, res) => {
    return res.status(200).json({ ok: true, data: null });
});

// /api/inspections/list → GET
router.get("/inspections/list", (req, res) => {
    return res.status(200).json({ ok: true, inspections: [] });
});

// /api/inspections/[id] → GET
router.get("/inspections/:id", (req, res) => {
    const { id } = req.params;
    return res.status(200).json({ ok: true, inspection: null, id });
});

// /api/admin/stats → GET (superadmin only)
router.get("/admin/stats", requireSuperadmin, (req, res) => {
    return res.status(200).json({ ok: true, metrics: {} });
});

export default router;
