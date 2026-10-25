import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// 1x1 transparent PNG base64
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
// 1x1 JPEG base64
const TINY_JPEG_B64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

describe("mediaStorage service", () => {
  let tempDir;
  let originalDataDir;
  let mediaStorage;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-media-test-"));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tempDir;

    mediaStorage = await import("@/lib/mediaStorage.js");
  });

  afterEach(() => {
    process.env.DATA_DIR = originalDataDir;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("saves base64 image and infers png format", async () => {
    const result = await mediaStorage.saveBase64Image({
      b64: TINY_PNG_B64,
      generationId: "gen-123",
    });

    expect(result).toBeDefined();
    expect(result.format).toBe("png");
    expect(result.filename).toMatch(/^img_\d+_gen-123\.png$/);
    expect(result.relativeUrl).toBe(`/api/media/images/${result.filename}`);
    expect(fs.existsSync(result.fullPath)).toBe(true);
    expect(result.size).toBeGreaterThan(0);
  });

  it("saves base64 image and infers jpeg format from data header", async () => {
    const result = await mediaStorage.saveBase64Image({
      b64: TINY_JPEG_B64,
    });

    expect(result).toBeDefined();
    expect(result.format).toBe("jpg");
    expect(result.filename.endsWith(".jpg")).toBe(true);
    expect(fs.existsSync(result.fullPath)).toBe(true);
  });

  it("prunes old images when count exceeds maxCount", async () => {
    const dir = mediaStorage.getMediaImagesDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Create 5 fake images with different modification times
    const files = ["img_1.png", "img_2.png", "img_3.png", "img_4.png", "img_5.png"];
    for (let i = 0; i < files.length; i++) {
      const p = path.join(dir, files[i]);
      fs.writeFileSync(p, Buffer.from([i]));
      const time = (1000 + i * 100) / 1000;
      fs.utimesSync(p, time, time);
    }

    expect(fs.readdirSync(dir).length).toBe(5);

    // Prune to keep only 3
    await mediaStorage.pruneOldImages(dir, 3);

    const remaining = fs.readdirSync(dir).sort();
    expect(remaining.length).toBe(3);
    // Oldest 2 (img_1.png, img_2.png) should be deleted
    expect(remaining).toEqual(["img_3.png", "img_4.png", "img_5.png"]);
  });

  it("getSafeImageFile blocks path traversal and accepts valid files", async () => {
    const result = await mediaStorage.saveBase64Image({
      b64: TINY_PNG_B64,
      generationId: "safe-test",
    });

    // Valid file
    const safePath = mediaStorage.getSafeImageFile(result.filename);
    expect(safePath).toBe(result.fullPath);

    // Path traversal attempt
    expect(mediaStorage.getSafeImageFile("../../../etc/passwd")).toBeNull();
    expect(mediaStorage.getSafeImageFile("..\\..\\windows\\system32")).toBeNull();
    expect(mediaStorage.getSafeImageFile("not-an-image.exe")).toBeNull();
    expect(mediaStorage.getSafeImageFile("non-existent-file.png")).toBeNull();
  });
});

describe("GET /api/media/images/[filename] route", () => {
  let tempDir;
  let originalDataDir;
  let mediaStorage;
  let routeHandler;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-media-route-test-"));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tempDir;

    mediaStorage = await import("@/lib/mediaStorage.js");
    routeHandler = await import("@/app/api/media/images/[filename]/route.js");
  });

  afterEach(() => {
    process.env.DATA_DIR = originalDataDir;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("serves an existing image with correct headers", async () => {
    const saved = await mediaStorage.saveBase64Image({
      b64: TINY_PNG_B64,
    });

    const req = new Request(`http://localhost:20128/api/media/images/${saved.filename}`);
    const res = await routeHandler.GET(req, { params: Promise.resolve({ filename: saved.filename }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toContain("immutable");

    const arrayBuf = await res.arrayBuffer();
    expect(arrayBuf.byteLength).toBe(saved.size);
  });

  it("returns 404 for missing image or malicious filename", async () => {
    const req = new Request(`http://localhost:20128/api/media/images/missing.png`);
    const res = await routeHandler.GET(req, { params: Promise.resolve({ filename: "missing.png" }) });
    expect(res.status).toBe(404);

    const maliciousReq = new Request(`http://localhost:20128/api/media/images/..%2F..%2Fpasswd`);
    const maliciousRes = await routeHandler.GET(maliciousReq, { params: Promise.resolve({ filename: "../../passwd" }) });
    expect(maliciousRes.status).toBe(404);
  });
});
