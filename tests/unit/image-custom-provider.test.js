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



  it("routes to /images/edits and returns FormData when reference images are present", async () => {
    const adapter = getImageAdapter("openai-compatible-test");
    const creds = { providerSpecificData: { baseUrl: "https://my-relay.com/v1" } };

    const urlWithImg = adapter.buildUrl("gpt-image-2.5-flare", creds, {
      prompt: "make it blue",
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    });
    expect(urlWithImg).toBe("https://my-relay.com/v1/images/edits");

    const urlWithoutImg = adapter.buildUrl("gpt-image-2.5-flare", creds, {
      prompt: "a green cat",
    });
    expect(urlWithoutImg).toBe("https://my-relay.com/v1/images/generations");

    const bodyWithImg = await adapter.buildBody("gpt-image-2.5-flare", {
      prompt: "make it blue",
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      quality: "high",
    });
    expect(bodyWithImg instanceof FormData).toBe(true);
    expect(bodyWithImg.get("prompt")).toBe("make it blue");
    expect(bodyWithImg.get("model")).toBe("gpt-image-2.5-flare");
    expect(bodyWithImg.get("quality")).toBe("high");
    expect(bodyWithImg.get("image")).toBeDefined();

    const headers = adapter.buildHeaders({ apiKey: "sk-123" }, bodyWithImg);
    // FormData should not have Content-Type set manually
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers["Authorization"]).toBe("Bearer sk-123");
  });
