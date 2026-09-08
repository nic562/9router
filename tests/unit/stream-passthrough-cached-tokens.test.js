import { describe, it, expect } from "vitest";
import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

async function consumeStream(stream, chunks) {
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const writePromise = (async () => {
    for (const chunk of chunks) {
      await writer.write(encoder.encode(chunk));
    }
    await writer.close();
  })();

  let received = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += decoder.decode(value, { stream: true });
  }
  await writePromise;
  return received;
}

describe("stream passthrough and usage preservation", () => {
  it("does not inject fake estimated usage when finish_reason arrives before usage chunk in PASSTHROUGH mode", async () => {
    let completedUsage = null;
    const stream = createPassthroughStreamWithLogger(
      "openai",
      null,
      "gpt-5.6",
      "conn-1",
      { model: "gpt-5.6", messages: [{ role: "user", content: "hello" }] },
      (content, usage) => {
        completedUsage = usage;
      }
    );

    const chunks = [
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":5,"total_tokens":105,"prompt_tokens_details":{"cached_tokens":80}}}\n\n',
      'data: [DONE]\n\n'
    ];

    const result = await consumeStream(stream, chunks);

    const lines = result.split("\n").filter(l => l.startsWith("data: ") && !l.includes("[DONE]"));
    const parsedChunks = lines.map(l => JSON.parse(l.slice(6)));

    const finishChunk = parsedChunks.find(c => c.choices?.[0]?.finish_reason === "stop");
    expect(finishChunk).toBeDefined();
    // Finish chunk from upstream had no usage; passthrough should not inject fake estimated usage into it!
    expect(finishChunk.usage).toBeUndefined();

    // The real usage chunk should be passed through with cached_tokens intact
    const usageChunk = parsedChunks.find(c => c.usage !== undefined);
    expect(usageChunk).toBeDefined();
    expect(usageChunk.usage.prompt_tokens).toBe(100);
    expect(usageChunk.usage.prompt_tokens_details?.cached_tokens).toBe(80);

    // onStreamComplete should record the real usage with cached_tokens
    expect(completedUsage.prompt_tokens).toBe(100);
    expect(completedUsage.prompt_tokens_details?.cached_tokens).toBe(80);
  });

  it("does not inject fake estimated usage when finish arrives before usage in TRANSLATE mode", async () => {
    let completedUsage = null;
    // targetFormat = sourceFormat = OPENAI for translate mode test
    const stream = createSSETransformStreamWithLogger(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "openai",
      null,
      null,
      "gpt-5.6",
      "conn-1",
      { model: "gpt-5.6", messages: [{ role: "user", content: "hello" }] },
      (content, usage) => {
        completedUsage = usage;
      }
    );

    const chunks = [
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":5,"total_tokens":105,"prompt_tokens_details":{"cached_tokens":80}}}\n\n',
      'data: [DONE]\n\n'
    ];

    const result = await consumeStream(stream, chunks);

    const lines = result.split("\n").filter(l => l.startsWith("data: ") && !l.includes("[DONE]"));
    const parsedChunks = lines.map(l => JSON.parse(l.slice(6)));

    const finishChunk = parsedChunks.find(c => c.choices?.[0]?.finish_reason === "stop");
    expect(finishChunk).toBeDefined();
    expect(finishChunk.usage).toBeUndefined();

    const usageChunk = parsedChunks.find(c => c.usage !== undefined);
    expect(usageChunk).toBeDefined();
    expect(usageChunk.usage.prompt_tokens).toBe(100);
    expect(usageChunk.usage.prompt_tokens_details?.cached_tokens).toBe(80);

    expect(completedUsage.prompt_tokens).toBe(100);
    expect(completedUsage.prompt_tokens_details?.cached_tokens).toBe(80);
  });
});

  it("falls back to estimateUsage in finalizeStream when provider never returned usage", async () => {
    let completedUsage = null;
    const stream = createPassthroughStreamWithLogger(
      "openai",
      null,
      "gpt-5.6",
      "conn-1",
      { model: "gpt-5.6", messages: [{ role: "user", content: "hello" }] },
      (content, usage) => {
        completedUsage = usage;
      }
    );

    // Stream ends without any usage chunk
    const chunks = [
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hello world"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ];

    const result = await consumeStream(stream, chunks);
    expect(completedUsage).toBeDefined();
    expect(completedUsage.estimated).toBe(true);
  });
