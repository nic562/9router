// Antigravity image adapter - delegates to the executor for correct request
// envelope (project, model, requestType, sessionId) and auth headers.
import { nowSec, urlToBase64 } from "./_base.js";
import { getExecutor } from "../../executors/index.js";

// Convert image input (data URI, public URL, or raw base64) to Gemini inlineData part
async function resolveImageInput(input) {
  if (!input) return null;

  // Object format { url: ... } or { b64_json: ... }
  if (typeof input === "object") {
    if (input.url) input = input.url;
    else if (input.b64_json) input = input.b64_json;
  }

  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Remote HTTP/HTTPS URL -> fetch and convert to base64
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const b64 = await urlToBase64(trimmed);
      return { inlineData: { mimeType: "image/png", data: b64 } };
    } catch {
      return null;
    }
  }

  // data:image/png;base64,... format
  const dataUriMatch = trimmed.match(/^data:(image\/[^;]+);base64,(.+)$/i);
  if (dataUriMatch) {
    return { inlineData: { mimeType: dataUriMatch[1], data: dataUriMatch[2] } };
  }

  // Raw base64 string (assume image/png)
  if (/^[A-Za-z0-9+/=]/.test(trimmed) && trimmed.length > 50) {
    return { inlineData: { mimeType: "image/png", data: trimmed } };
  }

  return null;
}

// Extract all candidate input images from standard/extra fields
function extractInputImages(body) {
  const images = [];

  // extra_body.image
  if (Array.isArray(body.extra_body?.image)) {
    images.push(...body.extra_body.image);
  } else if (body.extra_body?.image) {
    images.push(body.extra_body.image);
  }

  // top-level images array
  if (Array.isArray(body.images)) {
    images.push(...body.images);
  }

  // top-level image / image_url
  if (body.image) images.push(body.image);
  if (body.image_url) images.push(body.image_url);

  return images.filter(Boolean);
}

export default {
  // Delegate to executor instead of building URL/headers/body manually
  useExecutor: true,

  // Stubs - required by imageGenerationCore interface but unused with useExecutor
  buildUrl: () => "",
  buildHeaders: () => ({}),
  buildBody: () => ({}),

  async executeViaExecutor(model, body, credentials, log) {
    const executor = getExecutor("antigravity");
    if (!executor) throw new Error("Antigravity executor not found");

    // Build parts: text prompt + optional input images for editing / multi-image reference
    const parts = [];

    // Resolve reference images
    const rawImages = extractInputImages(body);
    for (const img of rawImages) {
      const inlineData = await resolveImageInput(img);
      if (inlineData) parts.push(inlineData);
    }

    // Append text prompt
    if (body.prompt) {
      parts.push({ text: body.prompt });
    }

    const chatBody = {
      contents: [{ role: "user", parts }],
      ratio: body.ratio || body.aspect_ratio,
      size: body.size,
      generationConfig: body.generationConfig,
    };

    const result = await executor.execute({
      model,
      body: chatBody,
      stream: false,
      credentials,
      log,
    });

    if (!result.response.ok) {
      const text = await result.response.text();
      throw new Error(text || `HTTP ${result.response.status}`);
    }

    return result.response.json();
  },

  normalize: (responseBody, prompt) => {
    const candidates = responseBody.candidates || responseBody.response?.candidates || [];
    const parts = candidates[0]?.content?.parts || [];
    const images = parts.filter((p) => p.inlineData?.data).map((p) => ({
      b64_json: p.inlineData.data,
    }));
    return {
      created: nowSec(),
      data: images.length > 0 ? images : [{ b64_json: "", revised_prompt: prompt }],
    };
  },
};
