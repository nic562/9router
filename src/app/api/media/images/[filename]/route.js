import fs from "node:fs";
import path from "node:path";
import { getSafeImageFile } from "@/lib/mediaStorage.js";

const MIME_MAP = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(request, context) {
  try {
    const params = context?.params ? await context.params : {};
    const filename = params?.filename;
    if (!filename) {
      return new Response("Filename is required", { status: 400 });
    }

    const fullPath = getSafeImageFile(filename);
    if (!fullPath) {
      return new Response("Image not found", { status: 404 });
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";
    const fileBuffer = await fs.promises.readFile(fullPath);

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("[media/images] Serve image error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
