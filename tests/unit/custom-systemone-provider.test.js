import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { isCustomSystemoneProvider, CUSTOM_SYSTEMONE_PREFIX } from "@/shared/constants/providers";
import { handleSystemoneCore } from "../../open-sse/handlers/systemoneCore.js";
import * as proxyFetchModule from "../../open-sse/utils/proxyFetch.js";

describe("Custom System One provider node support", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("identifies custom systemone provider ids", () => {
    expect(isCustomSystemoneProvider("custom-systemone-12345")).toBe(true);
    expect(isCustomSystemoneProvider("openai-compatible-chat-123")).toBe(false);
    expect(isCustomSystemoneProvider("custom-embedding-456")).toBe(false);
    expect(CUSTOM_SYSTEMONE_PREFIX).toBe("custom-systemone-");
  });

  it("routes through proxyAwareFetch and passes proxyOptions to custom baseUrl", async () => {
    const customNodeId = "custom-systemone-node-1";
    const customUpstreamUrl = "https://api.typesafe.ai/v1/systemone";

    const spy = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockImplementation(async (url, init, proxyOptions) => {
      expect(url).toBe(customUpstreamUrl);
      expect(proxyOptions.connectionProxyEnabled).toBe(true);
      expect(proxyOptions.connectionProxyUrl).toBe("http://127.0.0.1:7890");
      return new Response(JSON.stringify({
        state: "pong",
        answers: { probe: { option: "yes", confidence: 0.95 } },
        usage: { input_tokens: 10, output_tokens: 2 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const result = await handleSystemoneCore({
      body: {
        model: "jev-latest",
        state: "Customer wants urgent refund",
        questions: { probe: { type: "choice", criteria: ["urgent", "normal"] } },
      },
      modelInfo: { provider: customNodeId, model: "jev-latest" },
      credentials: {
        apiKey: "ts-official-key",
        providerSpecificData: {
          baseUrl: customUpstreamUrl,
          connectionProxyEnabled: true,
          connectionProxyUrl: "http://127.0.0.1:7890",
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 2 });
    const json = await result.response.json();
    expect(json.answers.probe.option).toBe("yes");

    spy.mockRestore();
  });

  it("supports arbitrary self-hosted or mirror baseUrls", async () => {
    const customNodeId = "custom-systemone-node-2";
    const customUpstreamUrl = "http://10.0.0.50:8080/v1/systemone";

    const spy = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockImplementation(async (url) => {
      expect(url).toBe(customUpstreamUrl);
      return new Response(JSON.stringify({ ok: true, state: "ok", answers: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const result = await handleSystemoneCore({
      body: {
        model: "my-decision-model",
        state: "test prompt",
        questions: { probe: { type: "noul", instructions: "test" } },
      },
      modelInfo: { provider: customNodeId, model: "my-decision-model" },
      credentials: {
        apiKey: "local-token",
        providerSpecificData: {
          baseUrl: customUpstreamUrl,
        },
      },
    });

    expect(result.success).toBe(true);
    spy.mockRestore();
  });
});
