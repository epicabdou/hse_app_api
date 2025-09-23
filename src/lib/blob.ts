// src/lib/blob.ts
import { put, type PutBlobResult } from "@vercel/blob";

/**
 * Upload a Buffer to Vercel Blob. Returns the public URL.
 * Requires BLOB_READ_WRITE_TOKEN (server token) when not running on Vercel.
 */
export async function uploadBufferToBlob(
    key: string,
    buffer: Buffer,
    contentType: string,
    options?: { access?: "public" }
): Promise<PutBlobResult> {
    return await put(key, buffer, {
        access: options?.access ?? "public",
        contentType,
        addRandomSuffix: true, // avoid collisions
    }); // { url, pathname, size, uploadedAt, ... }
}