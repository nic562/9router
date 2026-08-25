import { describe, it, expect } from "vitest";
import agnesAi from "../../open-sse/handlers/imageProviders/agnesAi.js";

describe("Agnes-AI image adapter", () => {
  it("builds correct URL and auth headers", () => {
    expect(agnesAi.buildUrl()).toBe("https://apihub.agnes-ai.com/v1/images/generations");
    const headers = agnesAi.buildHeaders({ apiKey: "test_key_123" });
    expect(headers.Authorization).toBe("Bearer test_key_123");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("builds clean text-to-image request without top-level response_format", () => {
    const body = {
      prompt: "a majestic mountain landscape",
      size: "1024x768",
      response_format: "url",
      n: 1,
    };
    const req = agnesAi.buildBody("agnes-image-2.0-flash", body);
    expect(req.model).toBe("agnes-image-2.0-flash");
    expect(req.prompt).toBe("a majestic mountain landscape");
    expect(req.size).toBe("1024x768");
    // Ensure response_format is NOT on top-level
    expect(req.response_format).toBeUndefined();
    expect(req.extra_body?.response_format).toBe("url");
    // Ensure n is not leaked if unnecessary
    expect(req.n).toBeUndefined();
  });

  it("sets return_base64 and extra_body.response_format for b64_json requests", () => {
    const body = {
      prompt: "a cybernetic dog",
      size: "1024x1024",
      response_format: "b64_json",
    };
    const req = agnesAi.buildBody("agnes-image-2.0-flash", body);
    expect(req.return_base64).toBe(true);
    expect(req.extra_body?.response_format).toBe("b64_json");
    expect(req.response_format).toBeUndefined();
  });

  it("supports ratio parameter for 2.1-flash", () => {
    const body = {
      prompt: "cinematic futuristic city",
      size: "2K",
      ratio: "16:9",
    };
    const req = agnesAi.buildBody("agnes-image-2.1-flash", body);
    expect(req.model).toBe("agnes-image-2.1-flash");
    expect(req.size).toBe("2K");
    expect(req.ratio).toBe("16:9");
  });

  it("extracts single image URL into extra_body.image array for img2img", () => {
    const body = {
      prompt: "make it anime style",
      image: "https://example.com/input.png",
    };
    const req = agnesAi.buildBody("agnes-image-2.0-flash", body);
    expect(req.extra_body?.image).toEqual(["https://example.com/input.png"]);
  });

  it("extracts multiple input images for multi-image composition", () => {
    const body = {
      prompt: "combine character and background",
      images: [
        "https://example.com/char.png",
        "https://example.com/bg.png",
      ],
    };
    const req = agnesAi.buildBody("agnes-image-2.1-flash", body);
    expect(req.extra_body?.image).toEqual([
      "https://example.com/char.png",
      "https://example.com/bg.png",
    ]);
  });

  it("normalizes API response to standard OpenAI format", () => {
    const apiResponse = {
      created: 1780000000,
      data: [
        {
          url: "https://storage.googleapis.com/agnes-aigc/output.png",
          b64_json: null,
          revised_prompt: null,
        },
      ],
    };
    const normalized = agnesAi.normalize(apiResponse, "test prompt");
    expect(normalized.created).toBe(1780000000);
    expect(normalized.data).toHaveLength(1);
    expect(normalized.data[0].url).toBe("https://storage.googleapis.com/agnes-aigc/output.png");
    expect(normalized.data[0].revised_prompt).toBe("test prompt");
  });
});
