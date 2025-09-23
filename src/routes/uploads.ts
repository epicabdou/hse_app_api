// src/routes/uploads.ts
import express from "express";
import { requireAuth, getAuth } from "@clerk/express";
import multer from "multer";
import { base64ToBuffer, compressToWebP } from "../lib/image.js";
import { uploadBufferToBlob } from "../lib/blob.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

function sanitize(name: string) {
    return String(name).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 80);
}

/** POST /api/uploads/base64  { base64, filename?, maxSide?, quality? } */
router.post("/base64", requireAuth(), async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const { base64, filename = "image", maxSide, quality } = req.body ?? {};
        if (!base64 || typeof base64 !== "string") return res.status(400).json({ error: "Missing base64" });

        const approxBytes = Math.floor(base64.length * 0.75);
        if (approxBytes > 8_000_000) return res.status(413).json({ error: "Image too large" });

        const raw = base64ToBuffer(base64);
        const webp = await compressToWebP(raw, { maxSide, quality });

        const key = `inspections/${userId}/${Date.now()}-${sanitize(filename)}.webp`;
        const put = await uploadBufferToBlob(key, webp.buffer, "image/webp", { access: "public" });

        res.status(200).json({
            ok: true,
            url: put.url,
            bytes: webp.bytes,
            width: webp.width,
            height: webp.height,
            contentType: "image/webp",
        });
    } catch (e: any) {
        console.error("uploads/base64", e);
        res.status(500).json({ error: "Internal server error", message: e?.message });
    }
});

/** POST /api/uploads/file  (multipart/form-data with field 'file') */
router.post("/file", requireAuth(), upload.single("file"), async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        if (!req.file) return res.status(400).json({ error: "Missing file" });

        const webp = await compressToWebP(req.file.buffer, { maxSide: 1600, quality: 72 });
        const key = `inspections/${userId}/${Date.now()}-${sanitize(req.file.originalname)}.webp`;
        const put = await uploadBufferToBlob(key, webp.buffer, "image/webp", { access: "public" });

        res.status(200).json({
            ok: true,
            url: put.url,
            bytes: webp.bytes,
            width: webp.width,
            height: webp.height,
            contentType: "image/webp",
        });
    } catch (e: any) {
        console.error("uploads/file", e);
        res.status(500).json({ error: "Internal server error", message: e?.message });
    }
});

export default router;