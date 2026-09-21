import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

describe("Connection serviceKinds scoping", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-service-kinds-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("filters out connections that do not include the requested kind", async () => {
    const { createProviderConnection } = await import("@/models/index.js");
    const { getProviderCredentials } = await import("@/sse/services/auth.js");

    // Key 1: Free key (LLM only)
    await createProviderConnection({
      provider: "gemini",
      name: "Free Key 1",
      apiKey: "key-free-1",
      priority: 1,
      serviceKinds: ["llm"],
    });

    // Key 2: Paid key (LLM + Image)
    await createProviderConnection({
      provider: "gemini",
      name: "Paid Key 2",
      apiKey: "key-paid-2",
      priority: 2,
      serviceKinds: ["llm", "image"],
    });

    // When requesting kind: "image", only Key 2 should be returned
    const imageCreds = await getProviderCredentials("gemini", null, "imagen-3.0", { kind: "image" });
    expect(imageCreds).not.toBeNull();
    expect(imageCreds.apiKey).toBe("key-paid-2");
    expect(imageCreds.connectionName).toBe("Paid Key 2");

    // When requesting kind: "llm", Key 1 should be picked by priority (priority 1)
    const llmCreds = await getProviderCredentials("gemini", null, "gemini-2.5-flash", { kind: "llm" });
    expect(llmCreds).not.toBeNull();
    expect(llmCreds.apiKey).toBe("key-free-1");

    // When key 1 is excluded during LLM, Key 2 can still be used for LLM
    const llmFallback = await getProviderCredentials("gemini", new Set([llmCreds.connectionId]), "gemini-2.5-flash", { kind: "llm" });
    expect(llmFallback).not.toBeNull();
    expect(llmFallback.apiKey).toBe("key-paid-2");
  });

  it("treats connection with empty or undefined serviceKinds as unrestricted", async () => {
    const { createProviderConnection } = await import("@/models/index.js");
    const { getProviderCredentials } = await import("@/sse/services/auth.js");

    await createProviderConnection({
      provider: "gemini",
      name: "Legacy Unrestricted Key",
      apiKey: "key-legacy",
      priority: 1,
    });

    const imageCreds = await getProviderCredentials("gemini", null, "imagen-3.0", { kind: "image" });
    expect(imageCreds).not.toBeNull();
    expect(imageCreds.apiKey).toBe("key-legacy");

    const llmCreds = await getProviderCredentials("gemini", null, "gemini-2.5-flash", { kind: "llm" });
    expect(llmCreds).not.toBeNull();
    expect(llmCreds.apiKey).toBe("key-legacy");
  });
});
