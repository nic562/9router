import { describe, expect, it, vi } from "vitest";
import { handleComboChat, handleFusionChat } from "../../open-sse/services/combo.js";

describe("combo client disconnect / abort handling", () => {
  it("stops combo fallback immediately when a model returns status 499", async () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["openai/gpt-4o", "anthropic/claude-3-5-sonnet"];
    const clientAbortedResponse = Response.json(
      { error: { message: "Client closed request", code: "client_closed_request" } },
      { status: 499 }
    );
    const successResponse = Response.json({ choices: [{ message: { content: "ok" } }] });

    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(clientAbortedResponse)
      .mockResolvedValueOnce(successResponse);

    const controller = new AbortController();
    const response = await handleComboChat({
      body,
      models,
      handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "test-abort-combo",
      comboStrategy: "fallback",
      signal: controller.signal,
    });

    expect(response.status).toBe(499);
    // Model 2 MUST NOT be called!
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    expect(handleSingleModel).toHaveBeenCalledWith(body, "openai/gpt-4o");
  });

  it("stops combo fallback immediately when signal is already aborted before next model", async () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["openai/gpt-4o", "anthropic/claude-3-5-sonnet"];
    const serverError = Response.json({ error: { message: "Overloaded" } }, { status: 502 });

    const controller = new AbortController();
    const handleSingleModel = vi.fn().mockImplementation(async () => {
      // Client disconnects during the first model's run
      controller.abort();
      return serverError;
    });

    const response = await handleComboChat({
      body,
      models,
      handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "test-abort-combo",
      comboStrategy: "fallback",
      signal: controller.signal,
    });

    expect(response.status).toBe(499);
    // Model 2 MUST NOT be called because signal.aborted is true
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
  });

  it("aborts fusion chat immediately when signal is aborted", async () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["openai/gpt-4o", "anthropic/claude-3-5-sonnet"];
    const controller = new AbortController();
    controller.abort();

    const handleSingleModel = vi.fn();
    const response = await handleFusionChat({
      body,
      models,
      handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "test-fusion",
      signal: controller.signal,
    });

    expect(response.status).toBe(499);
    expect(handleSingleModel).not.toHaveBeenCalled();
  });

  it("aborts fusion chat before judge model if client disconnects during panel calls", async () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["openai/gpt-4o", "anthropic/claude-3-5-sonnet"];
    const controller = new AbortController();

    const okResponse = (content) => Response.json({
      choices: [{ message: { content } }]
    });

    const handleSingleModel = vi.fn().mockImplementation(async (b, m, isPanel) => {
      if (isPanel) {
        // Disconnect while panel is answering
        controller.abort();
        return okResponse(`Answer from ${m}`);
      }
      return okResponse("Judge answer");
    });

    const response = await handleFusionChat({
      body,
      models,
      handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "test-fusion",
      signal: controller.signal,
    });

    expect(response.status).toBe(499);
    // Panel calls (2) occurred, but judge was NEVER called (isPanel = false)
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });

  it("stops combo chat before smart router evaluation if signal already aborted", async () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["openai/gpt-4o", "anthropic/claude-3-5-sonnet"];
    const controller = new AbortController();
    controller.abort();

    const resolveSmartChoice = vi.fn();
    const handleSingleModel = vi.fn();

    const response = await handleComboChat({
      body,
      models,
      handleSingleModel,
      resolveSmartChoice,
      comboStrategy: "smart",
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "test-smart-combo",
      signal: controller.signal,
    });

    expect(response.status).toBe(499);
    expect(resolveSmartChoice).not.toHaveBeenCalled();
    expect(handleSingleModel).not.toHaveBeenCalled();
  });
});
