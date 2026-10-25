import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDataDir } from "@/lib/dataDir.js";

export function getMediaImagesDir() {
  return path.join(getDataDir(), "media", "images");
}

export const DEFAULT_MAX_SAVED_IMAGES = 1000;

function ensureMediaDir(dir = getMediaImagesDir()) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Infer extension from base64 header or explicit format string
 */
export function inferImageExtension(b64, explicitFormat) {
  if (explicitFormat) {
    const fmt = String(explicitFormat).toLowerCase().replace(/^\./, "");
    if (fmt === "jpeg" || fmt === "jpg") return "jpg";
    if (fmt === "webp") return "webp";
    if (fmt === "gif") return "gif";
    if (fmt === "png") return "png";
  }

  if (typeof b64 === "string" && b64.length >= 12) {
    const head = b64.slice(0, 15);
    if (head.startsWith("iVBORw0KGgo")) return "png";
    if (head.startsWith("/9j/")) return "jpg";
    if (head.startsWith("UklGR")) return "webp";
    if (head.startsWith("R0lGOD")) return "gif";
  }

  return "png";
}

let lastPruneTime = 0;
const PRUNE_THROTTLE_MS = 30000; // Run prune at most once every 30 seconds

/**
 * Prune old images if total exceeds maxCount (keeps the newest maxCount files)
 */
export async function pruneOldImages(dir = getMediaImagesDir(), maxCount = DEFAULT_MAX_SAVED_IMAGES) {
  try {
    if (!fs.existsSync(dir)) return;
    const files = await fs.promises.readdir(dir);
    if (files.length <= maxCount) return;

    const fileStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(dir, file);
        try {
          const stat = await fs.promises.stat(filePath);
          if (!stat.isFile()) return null;
          return { file, filePath, mtime: stat.mtimeMs };
        } catch {
          return null;
        }
      })
    );

    const validFiles = fileStats.filter(Boolean);
    if (validFiles.length <= maxCount) return;

    // Sort ascending by modification time (oldest first)
    validFiles.sort((a, b) => a.mtime - b.mtime);

    const toRemoveCount = validFiles.length - maxCount;
    const toRemove = validFiles.slice(0, toRemoveCount);

    await Promise.all(
      toRemove.map((item) => fs.promises.unlink(item.filePath).catch(() => {}))
    );
  } catch (err) {
    console.error("[mediaStorage] Prune failed:", err?.message || err);
  }
}

/**
 * Save a base64 image string to the local media directory
 * @param {object} options
 * @param {string} options.b64 - Base64 encoded image content
 * @param {string} [options.format] - Explicit format (png, jpg, webp, etc.)
 * @param {string} [options.generationId] - Optional generation/request ID
 * @param {number} [options.maxSavedImages] - Max images to keep
 * @returns {Promise<{ filename: string, relativeUrl: string, fullPath: string, size: number, format: string }>}
 */
export async function saveBase64Image({ b64, format, generationId, maxSavedImages }) {
  if (!b64 || typeof b64 !== "string") {
    throw new Error("Invalid base64 data");
  }

  const dir = getMediaImagesDir();
  ensureMediaDir(dir);

  const cleanB64 = b64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
  const ext = inferImageExtension(cleanB64, format);
  const buffer = Buffer.from(cleanB64, "base64");

  const safeGenId = generationId
    ? String(generationId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32)
    : crypto.randomBytes(6).toString("hex");

  const filename = `img_${Date.now()}_${safeGenId}.${ext}`;
  const fullPath = path.join(dir, filename);

  await fs.promises.writeFile(fullPath, buffer);

  // Trigger throttled background prune
  const now = Date.now();
  if (now - lastPruneTime > PRUNE_THROTTLE_MS) {
    lastPruneTime = now;
    const configuredLimit = maxSavedImages || parseInt(process.env.MAX_SAVED_IMAGES || String(DEFAULT_MAX_SAVED_IMAGES), 10);
    pruneOldImages(dir, configuredLimit).catch(() => {});
  }

  return {
    filename,
    relativeUrl: `/api/media/images/${filename}`,
    fullPath,
    size: buffer.length,
    format: ext,
  };
}

/**
 * Securely get file path of an image, preventing path traversal
 */
export function getSafeImageFile(filename) {
  if (!filename || typeof filename !== "string") return null;
  // Strictly allow only safe filename pattern
  if (!/^[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/i.test(filename)) {
    return null;
  }
  const safeName = path.basename(filename);
  const fullPath = path.join(getMediaImagesDir(), safeName);
  if (!fs.existsSync(fullPath)) return null;
  return fullPath;
}
