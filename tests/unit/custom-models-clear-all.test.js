import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let localDb;
let handleCustomDelete;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-clear-all-test-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  localDb = await import("@/lib/localDb.js");
  const route = await import("@/app/api/models/custom/route.js");
  handleCustomDelete = route.DELETE;
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Clear All Custom Models", () => {
  it("deleteAllCustomModels removes all models for specific provider", async () => {
    await localDb.addCustomModel({ providerAlias: "clear-test-node", id: "m1", type: "llm" });
    await localDb.addCustomModel({ providerAlias: "clear-test-node", id: "m2", type: "image" });
    await localDb.addCustomModel({ providerAlias: "keep-test-node", id: "m3", type: "llm" });

    const removed = await localDb.deleteAllCustomModels("clear-test-node");
    expect(removed).toContain("m1");
    expect(removed).toContain("m2");

    const all = await localDb.getCustomModels();
    expect(all.find((m) => m.providerAlias === "clear-test-node")).toBeUndefined();
    expect(all.find((m) => m.providerAlias === "keep-test-node")).toBeDefined();

    // cleanup
    await localDb.deleteAllCustomModels("keep-test-node");
  });

  it("DELETE /api/models/custom?providerAlias=xxx&all=true works via API", async () => {
    await localDb.addCustomModel({ providerAlias: "api-clear-node", id: "model-a", type: "llm" });
    await localDb.addCustomModel({ providerAlias: "api-clear-node", id: "model-b", type: "image" });

    const req = new Request("http://localhost/api/models/custom?providerAlias=api-clear-node&all=true", {
      method: "DELETE",
    });
    const res = await handleCustomDelete(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.count).toBe(2);

    const all = await localDb.getCustomModels();
    expect(all.find((m) => m.providerAlias === "api-clear-node")).toBeUndefined();
  });
});
