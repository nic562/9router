import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("Image generation base64 persistence end-to-end", () => {
  let tempDir;
  let originalDataDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-img-e2e-"));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tempDir;
  });

  it("persists base64 images into media directory and formats detail record correctly", async () => {
    const { saveBase64Image, getMediaImagesDir } = await import("@/lib/mediaStorage.js");

    const saved = await saveBase64Image({
      b64: TINY_PNG_B64,
      generationId: "gen-e2e",
    });

    expect(fs.existsSync(saved.fullPath)).toBe(true);
    expect(saved.relativeUrl).toMatch(/^\/api\/media\/images\/img_\d+_gen-e2e\.png$/);

    const dir = getMediaImagesDir();
    const files = fs.readdirSync(dir);
    expect(files.length).toBe(1);
    expect(files[0]).toBe(saved.filename);
  });
});
