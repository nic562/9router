import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

import { checkFallbackError, applyErrorState } from "../../open-sse/services/accountFallback.js";
import { NON_FALLBACK_STATUSES } from "../../open-sse/config/errorConfig.js";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";

describe("Client error (400, 422, etc.) fallback prevention", () => {
  describe("checkFallbackError", () => {
    it("returns shouldFallback: false for 400 Bad Request with generic error message", () => {
      const result = checkFallbackError(400, "Bad Request");
      expect(result.shouldFallback).toBe(false);
      expect(result.cooldownMs).toBe(0);
    });

    it("returns shouldFallback: false for Google Gemini INVALID_ARGUMENT 400", () => {
      const errorText = JSON.stringify({
        error: {
          code: 400,
          message: "Request contains an invalid argument.",
          status: "INVALID_ARGUMENT"
        }
      });
      const result = checkFallbackError(400, errorText);
      expect(result.shouldFallback).toBe(false);
      expect(result.cooldownMs).toBe(0);
    });

    it("returns shouldFallback: false for 422 Unprocessable Entity", () => {
      const result = checkFallbackError(422, "Field validation error: messages cannot be empty");
      expect(result.shouldFallback).toBe(false);
      expect(result.cooldownMs).toBe(0);
    });

    it("returns shouldFallback: false for 405 Method Not Allowed", () => {
      const result = checkFallbackError(405, "Method Not Allowed");
      expect(result.shouldFallback).toBe(false);
      expect(result.cooldownMs).toBe(0);
    });

    it("prioritizes text-based rate limit rules even if status is 400", () => {
      const result = checkFallbackError(400, "rate limit exceeded for this model");
      expect(result.shouldFallback).toBe(true);
      expect(result.cooldownMs).toBeGreaterThan(0);
    });

    it("prioritizes text-based quota exceeded rules even if status is 400", () => {
      const result = checkFallbackError(400, "quota exceeded");
      expect(result.shouldFallback).toBe(true);
      expect(result.cooldownMs).toBeGreaterThan(0);
    });

    it("still returns shouldFallback: true for server errors and rate limits", () => {
      expect(checkFallbackError(429, "Too Many Requests").shouldFallback).toBe(true);
      expect(checkFallbackError(500, "Internal Server Error").shouldFallback).toBe(true);
      expect(checkFallbackError(502, "Bad Gateway").shouldFallback).toBe(true);
      expect(checkFallbackError(503, "Service Unavailable").shouldFallback).toBe(true);
      expect(checkFallbackError(401, "Unauthorized").shouldFallback).toBe(true);
      expect(checkFallbackError(403, "Forbidden").shouldFallback).toBe(true);
    });
  });

  describe("applyErrorState", () => {
    it("does not lock account or set error status on 400 client error", () => {
      const account = {
        id: "acc_1",
        status: "active",
        backoffLevel: 0,
        rateLimitedUntil: null
      };
      const updated = applyErrorState(account, 400, "Request contains an invalid argument.");
      expect(updated.status).toBe("active");
      expect(updated.rateLimitedUntil).toBeNull();
      expect(updated.lastError.status).toBe(400);
      expect(updated.lastError.message).toBe("Request contains an invalid argument.");
    });

    it("locks account and sets error status on 429 rate limit", () => {
      const account = {
        id: "acc_1",
        status: "active",
        backoffLevel: 0,
        rateLimitedUntil: null
      };
      const updated = applyErrorState(account, 429, "Rate limit exceeded");
      expect(updated.status).toBe("error");
      expect(updated.rateLimitedUntil).not.toBeNull();
      expect(updated.backoffLevel).toBe(1);
    });
  });

  describe("Combo chat stops on 400 instead of cascading", () => {
    it("immediately returns 400 response from primary model without trying fallback models", async () => {
      const handleSingleModel = vi.fn();

      // Primary model fails with 400 Bad Request
      handleSingleModel.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: "Request contains an invalid argument.",
              status: "INVALID_ARGUMENT"
            }
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      );

      const log = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const result = await handleComboChat({
        body: { messages: [{ role: "user", content: "test" }] },
        models: ["provider-a/model-1", "provider-b/model-2", "provider-c/model-3"],
        handleSingleModel,
        log,
        comboName: "test-combo",
        comboStrategy: "fallback"
      });

      expect(result.status).toBe(400);
      // Ensure it only called the first model and stopped!
      expect(handleSingleModel).toHaveBeenCalledTimes(1);
      expect(handleSingleModel).toHaveBeenCalledWith(expect.anything(), "provider-a/model-1");
    });

    it("still falls back to second model on 503 Service Unavailable", async () => {
      const handleSingleModel = vi.fn();

      // Primary model fails with 503
      handleSingleModel.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "Service Unavailable" } }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        )
      );

      // Secondary model succeeds
      handleSingleModel.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const log = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const result = await handleComboChat({
        body: { messages: [{ role: "user", content: "test" }] },
        models: ["provider-a/model-1", "provider-b/model-2"],
        handleSingleModel,
        log,
        comboName: "test-combo",
        comboStrategy: "fallback"
      });

      expect(result.status).toBe(200);
      expect(handleSingleModel).toHaveBeenCalledTimes(2);
    });
  });

  describe("Early empty messages validation in chatCore", () => {
    it("returns 400 bad request locally when messages array is empty", async () => {
      const result = await handleChatCore({
        body: {
          model: "gemini/gemini-2.5-flash",
          messages: [],
          tools: [{ type: "function", function: { name: "test_tool" } }]
        },
        modelInfo: { provider: "gemini", model: "gemini-2.5-flash" },
        credentials: { apiKey: "fake-key" },
        log: { warn: vi.fn() }
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
      expect(result.error).toContain("messages must not be empty");
    });
  });
});
