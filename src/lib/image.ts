// src/lib/image.ts
import sharp from "sharp";

export type CompressOptions = {
    /** Pixel cap for the longest edge (keeps aspect ratio). Default 1600. */
    maxSide?: number;
    /** WebP quality 1–100. Default 72. */
    quality?: number;
};

export type CompressedImage = {
    buffer: Buffer;
    mime: "image/webp";
    width: number;
    height: number;
    bytes: number;
};

export function base64ToBuffer(b64: string): Buffer {
    const comma = b64.indexOf(",");
    const pure = comma >= 0 ? b64.slice(comma + 1) : b64;
    return Buffer.from(pure, "base64");
}

export async function compressToWebP(
    input: Buffer,
    { maxSide = 1600, quality = 72 }: { maxSide?: number; quality?: number } = {}
) {
    const src = sharp(input).rotate();
    const meta = await src.metadata();
    const pipe =
        meta.width && meta.height
            ? (meta.width >= meta.height ? src.resize({ width: maxSide }) : src.resize({ height: maxSide }))
            : src.resize({ width: maxSide });

    const out = await pipe.webp({ quality, effort: 5 }).toBuffer();
    const sized = await sharp(out).metadata();
    return {
        buffer: out,
        mime: "image/webp" as const,
        width: sized.width ?? 0,
        height: sized.height ?? 0,
        bytes: out.byteLength,
    };
}