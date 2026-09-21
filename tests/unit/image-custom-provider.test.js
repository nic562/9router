import { describe, it, expect } from "vitest";
import { getImageAdapter, isImageProvider } from "open-sse/handlers/imageProviders/index.js";
import { inferModelKind } from "@/shared/constants/models.js";

describe("Custom image provider support", () => {
  it("recognizes openai-compatible provider in getImageAdapter", () => {
    const providerId = "openai-compatible-chat-1234";
    expect(isImageProvider(providerId)).toBe(true);
    const adapter = getImageAdapter(providerId);
    expect(adapter).not.toBeNull();
    expect(typeof adapter.buildUrl).toBe("function");

    // Check URL generation with credentials
    const creds = {
      providerSpecificData: {
        baseUrl: "https://my-proxy.com/v1",
      },
    };
    const url = adapter.buildUrl("gpt-image-2.5-flare", creds);
    expect(url).toBe("https://my-proxy.com/v1/images/generations");
  });

  it("handles trailing slashes and /images suffix in custom baseUrl", () => {
    const adapter = getImageAdapter("openai-compatible-node");
    const creds = {
      providerSpecificData: {
        baseUrl: "https://my-proxy.com/v1/images/",
      },
    };
    const url = adapter.buildUrl("gpt-image-2.5-sunburst", creds);
    expect(url).toBe("https://my-proxy.com/v1/images/generations");
  });

  it("correctly infers model kind for gpt-image models", () => {
    expect(inferModelKind("gpt-image-2.5-flare")).toBe("image");
    expect(inferModelKind("gpt-image-2.5-sunburst")).toBe("image");
    expect(inferModelKind("dall-e-3")).toBe("image");
    expect(inferModelKind("text-embedding-3-small")).toBe("embedding");
    expect(inferModelKind("claude-3-5-sonnet")).toBe(null);
  });
});
