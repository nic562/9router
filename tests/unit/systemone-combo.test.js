import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { handleSystemone } from "@/sse/handlers/systemone.js";
import * as authService from "@/sse/services/auth.js";
import * as localDb from "@/lib/localDb";
import * as modelService from "@/sse/services/model.js";
import * as systemoneCoreModule from "../../open-sse/handlers/systemoneCore.js";

describe("System One Combo (fallback & round-robin)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeRequest = (body) => {
    return new Request("http://localhost:20128/v1/systemone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  it("fails over to secondary model when primary model in combo fails", async () => {
    vi.spyOn(localDb, "getSettings").mockResolvedValue({
      requireApiKey: false,
      comboStrategy: "fallback",
    });

    vi.spyOn(modelService, "getComboModels").mockImplementation(async (name) => {
      if (name === "decision-combo") {
        return ["opencode-zen/jev-1.13-free", "custom-systemone-node/jev-latest"];
      }
      return null;
    });

    vi.spyOn(modelService, "getModelInfo").mockImplementation(async (modelStr) => {
      if (modelStr === "opencode-zen/jev-1.13-free") {
        return { provider: "opencode-zen", model: "jev-1.13-free" };
      }
      if (modelStr === "custom-systemone-node/jev-latest") {
        return { provider: "custom-systemone-node", model: "jev-latest" };
      }
      return { provider: null };
    });

    vi.spyOn(authService, "getProviderCredentials").mockImplementation(async (provider, excludeConnectionIds) => {
      if (excludeConnectionIds.has(`conn-${provider}`)) return null;
      return {
        connectionId: `conn-${provider}`,
        connectionName: `${provider} Account`,
        apiKey: "test-token",
        providerSpecificData: {},
      };
    });

    vi.spyOn(authService, "markAccountUnavailable").mockImplementation(async () => {
      return { shouldFallback: true };
    });

    const calls = [];
    vi.spyOn(systemoneCoreModule, "handleSystemoneCore").mockImplementation(async ({ modelInfo }) => {
      calls.push(modelInfo.provider);
      if (modelInfo.provider === "opencode-zen") {
        // First model fails with 500 error
        return {
          success: false,
          status: 500,
          error: "Zen service temporarily down",
          response: new Response(JSON.stringify({ error: "down" }), { status: 500 }),
        };
      }
      // Second model succeeds
      return {
        success: true,
        response: new Response(JSON.stringify({
          model: "jev-latest",
          answers: { is_urgent: { type: "noul", noul: 0.98 } },
        }), { status: 200, headers: { "Content-Type": "application/json" } }),
      };
    });

    const req = makeRequest({
      model: "decision-combo",
      state: "Billing error on customer checkout",
      questions: { is_urgent: { type: "noul", instructions: "Urgent?" } },
    });

    const res = await handleSystemone(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.answers.is_urgent.noul).toBe(0.98);

    // Verify fallback chain: first opencode-zen, then custom-systemone-node
    expect(calls).toEqual(["opencode-zen", "custom-systemone-node"]);
  });
});
