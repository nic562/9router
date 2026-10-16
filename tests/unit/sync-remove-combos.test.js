import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let localDb;
let handleDisablePost;
let handleCustomDelete;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-sync-remove-combos-test-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  localDb = await import("../../src/lib/localDb.js");
  const disableRoute = await import("../../src/app/api/models/disabled/route.js");
  handleDisablePost = disableRoute.POST;
  const customRoute = await import("../../src/app/api/models/custom/route.js");
  handleCustomDelete = customRoute.DELETE;
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Sync Remove Models from Combos", () => {
  beforeEach(async () => {
    // Reset settings
    await localDb.updateSettings({
      syncRemoveFromCombosOnModelRemoval: false,
    });

    // Clean up all existing combos in isolated temp DB
    const combos = await localDb.getCombos();
    for (const c of combos) {
      await localDb.deleteCombo(c.id);
    }
  });

  it("pruneModelsFromCombos should remove matching models across multiple combos with various alias formats", async () => {
    const combo1 = await localDb.createCombo({
      name: "combo-test-1",
      models: ["anthropic/claude-3-5-sonnet", "openai/gpt-4o", "google/gemini-1.5-pro"],
    });

    const combo2 = await localDb.createCombo({
      name: "combo-test-2",
      models: ["claude/claude-3-5-sonnet", "qoder/gpt-4o", "anthropic/claude-3-haiku"],
    });

    // Prune claude-3-5-sonnet using alias 'claude'
    const result = await localDb.pruneModelsFromCombos("claude", ["claude-3-5-sonnet"]);
    expect(result.affectedCombos.length).toBe(2);

    const updated1 = (await localDb.getCombos()).find((c) => c.id === combo1.id);
    const updated2 = (await localDb.getCombos()).find((c) => c.id === combo2.id);

    expect(updated1.models).toEqual(["openai/gpt-4o", "google/gemini-1.5-pro"]);
    expect(updated2.models).toEqual(["qoder/gpt-4o", "anthropic/claude-3-haiku"]);
  });

  it("when syncRemoveFromCombosOnModelRemoval is false, disabling models should NOT prune combos", async () => {
    await localDb.updateSettings({ syncRemoveFromCombosOnModelRemoval: false });

    const combo = await localDb.createCombo({
      name: "combo-disabled-off",
      models: ["openai/gpt-4o", "anthropic/claude-3-5-sonnet"],
    });

    const req = new Request("http://localhost/api/models/disabled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerAlias: "openai", ids: ["gpt-4o"] }),
    });
    const res = await handleDisablePost(req);
    expect(res.status).toBe(200);

    const check = (await localDb.getCombos()).find((c) => c.id === combo.id);
    expect(check.models).toEqual(["openai/gpt-4o", "anthropic/claude-3-5-sonnet"]);
  });

  it("when syncRemoveFromCombosOnModelRemoval is true, disabling models via API should prune combos", async () => {
    await localDb.updateSettings({ syncRemoveFromCombosOnModelRemoval: true });

    const combo = await localDb.createCombo({
      name: "combo-disabled-on",
      models: ["openai/gpt-4o", "anthropic/claude-3-5-sonnet", "openai/gpt-4o-mini"],
    });

    const req = new Request("http://localhost/api/models/disabled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerAlias: "openai", ids: ["gpt-4o", "gpt-4o-mini"] }),
    });
    const res = await handleDisablePost(req);
    expect(res.status).toBe(200);

    const check = (await localDb.getCombos()).find((c) => c.id === combo.id);
    expect(check.models).toEqual(["anthropic/claude-3-5-sonnet"]);
  });

  it("when syncRemoveFromCombosOnModelRemoval is true, deleting custom model should prune combos", async () => {
    await localDb.updateSettings({ syncRemoveFromCombosOnModelRemoval: true });

    // Register a custom model
    await localDb.addCustomModel({
      providerAlias: "custom-node",
      id: "my-llm-v1",
      type: "llm",
    });

    const combo = await localDb.createCombo({
      name: "combo-with-custom",
      models: ["custom-node/my-llm-v1", "openai/gpt-4o"],
    });

    const req = new Request("http://localhost/api/models/custom?providerAlias=custom-node&id=my-llm-v1&type=llm", {
      method: "DELETE",
    });
    const res = await handleCustomDelete(req);
    expect(res.status).toBe(200);

    const check = (await localDb.getCombos()).find((c) => c.id === combo.id);
    expect(check.models).toEqual(["openai/gpt-4o"]);
  });

  it("hollowing out a combo should leave models as empty array []", async () => {
    await localDb.updateSettings({ syncRemoveFromCombosOnModelRemoval: true });

    const combo = await localDb.createCombo({
      name: "combo-hollow",
      models: ["openai/gpt-4o"],
    });

    const req = new Request("http://localhost/api/models/disabled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerAlias: "openai", ids: ["gpt-4o"] }),
    });
    await handleDisablePost(req);

    const check = (await localDb.getCombos()).find((c) => c.id === combo.id);
    expect(check).toBeDefined();
    expect(check.models).toEqual([]);
  });

  it("disabling a provider connection should NOT prune combos", async () => {
    await localDb.updateSettings({ syncRemoveFromCombosOnModelRemoval: true });

    const combo = await localDb.createCombo({
      name: "combo-provider-disable",
      models: ["openai/gpt-4o", "anthropic/claude-3-5-sonnet"],
    });

    const conn = await localDb.createProviderConnection({
      provider: "openai",
      name: "Test Conn",
      apiKey: "sk-test",
      isActive: true,
    });

    // Disable provider connection
    await localDb.updateProviderConnection(conn.id, { isActive: false });

    // Combo models should remain intact!
    const check = (await localDb.getCombos()).find((c) => c.id === combo.id);
    expect(check.models).toEqual(["openai/gpt-4o", "anthropic/claude-3-5-sonnet"]);
  });
});
