/**
 * Unit tests verifying Agnes-AI models and media capabilities
 * are registered for `agnes-ai` (apikey provider).
 *
 * Run: cd tests && npx vitest run unit/provider-models-agnes-ai.test.js --reporter=verbose
 */

import { describe, it, expect } from "vitest";
import { PROVIDER_MODELS, getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";

const EXPECTED_LLM_IDS = ["agnes-2.0-flash", "agnes-2.5-flash"];
const EXPECTED_IMAGE_IDS = ["agnes-image-2.0-flash", "agnes-image-2.1-flash"];
const EXPECTED_VIDEO_IDS = ["agnes-video-v2.0", "agnes-video-2.5-flash"];
const ALL_IDS = [...EXPECTED_LLM_IDS, ...EXPECTED_IMAGE_IDS, ...EXPECTED_VIDEO_IDS];

describe("Agnes-AI model registration", () => {
  it("registers all model IDs under PROVIDER_MODELS['agnes-ai']", () => {
    const models = PROVIDER_MODELS["agnes-ai"] || [];
    const ids = models.map((m) => m.id);
    for (const id of ALL_IDS) {
      expect(ids).toContain(id);
    }
  });

  it("image models have kind 'image' and edit capabilities", () => {
    const models = PROVIDER_MODELS["agnes-ai"] || [];
    for (const id of EXPECTED_IMAGE_IDS) {
      const m = models.find((model) => model.id === id);
      expect(m).toBeDefined();
      expect(m.kind).toBe("image");
      expect(m.capabilities).toContain("edit");
      expect(m.capabilities).toContain("text2img");
      expect(m.capabilities).toContain("multi_image");
    }
  });

  it("video models have kind 'video' and video capabilities", () => {
    const models = PROVIDER_MODELS["agnes-ai"] || [];
    for (const id of EXPECTED_VIDEO_IDS) {
      const video = models.find((m) => m.id === id);
      expect(video).toBeDefined();
      expect(video.kind).toBe("video");
      expect(video.capabilities).toContain("text2video");
      expect(video.capabilities).toContain("image2video");
    }
  });

  it("LLM models have no explicit kind (defaults at runtime)", () => {
    const models = PROVIDER_MODELS["agnes-ai"] || [];
    for (const id of EXPECTED_LLM_IDS) {
      const m = models.find((model) => model.id === id);
      expect(m).toBeDefined();
      expect(m.kind).toBeUndefined();
    }
  });

  it("exposes models through getModelsByProviderId('agnes-ai')", () => {
    const apikeyModels = getModelsByProviderId("agnes-ai");
    for (const id of ALL_IDS) {
      expect(apikeyModels.some((m) => m.id === id)).toBe(true);
    }
  });

  it("registers serviceKinds including llm, image, video, imageToText", () => {
    const media = PROVIDER_MEDIA["agnes-ai"];
    expect(media).toBeDefined();
    expect(media.serviceKinds).toContain("llm");
    expect(media.serviceKinds).toContain("image");
    expect(media.serviceKinds).toContain("video");
    expect(media.serviceKinds).toContain("imageToText");
  });

  it("registers imageConfig and videoConfig endpoints with workflows and metadata", () => {
    const media = PROVIDER_MEDIA["agnes-ai"];
    expect(media.imageConfig?.baseUrl).toBe("https://apihub.agnes-ai.com/v1/images/generations");
    expect(media.imageConfig?.workflows).toContain("Image to Image (Edit)");
    expect(media.videoConfig?.baseUrl).toBe("https://apihub.agnes-ai.com/v1/videos");
  });
});
