import { describe, it, expect } from "vitest";
import antigravityImageAdapter from "../../open-sse/handlers/imageProviders/antigravity.js";
import geminiImageAdapter from "../../open-sse/handlers/imageProviders/gemini.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

describe("Antigravity & Gemini Image Adapter - Reference Image Support & Config", () => {
  it("antigravity executor preserves inlineData and imageConfig in contents for image-to-image", () => {
    const executor = new AntigravityExecutor();
    const fakeBody = {
      model: "gemini-3.1-flash-image",
      ratio: "16:9",
      size: "2K",
      request: {
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUg==" } },
              { text: "Change the shirt to white" },
            ],
          },
        ],
      },
    };

    const transformed = executor.transformRequest("gemini-3.1-flash-image", fakeBody, false, {
      projectId: "test-proj",
      accessToken: "fake-token",
    });

    expect(transformed.request.contents).toBeDefined();
    expect(transformed.request.contents[0].parts).toHaveLength(2);
    expect(transformed.request.contents[0].parts[0].inlineData).toBeDefined();
    expect(transformed.request.contents[0].parts[0].inlineData.mimeType).toBe("image/png");
    expect(transformed.request.contents[0].parts[1].text).toBe("Change the shirt to white");

    // GenerationConfig imageConfig verification
    expect(transformed.request.generationConfig.imageConfig).toEqual({
      aspectRatio: "16:9",
      imageSize: "2K",
    });
  });

  it("gemini adapter builds inlineData and imageConfig from input in body", async () => {
    const reqBody = await geminiImageAdapter.buildBody("gemini-3.1-flash-image-preview", {
      prompt: "A futuristic portrait",
      ratio: "3:4",
      size: "1K",
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
    });

    expect(reqBody.contents[0].parts).toHaveLength(2);
    expect(reqBody.contents[0].parts[0].inlineData.mimeType).toBe("image/png");
    expect(reqBody.contents[0].parts[0].inlineData.data).toBe("iVBORw0KGgoAAAANSUhEUg==");
    expect(reqBody.contents[0].parts[1].text).toBe("A futuristic portrait");

    expect(reqBody.generationConfig.imageConfig).toEqual({
      aspectRatio: "3:4",
      imageSize: "1K",
    });
  });
});
