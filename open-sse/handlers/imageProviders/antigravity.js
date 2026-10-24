// Antigravity image adapter - delegates to the executor for correct request
// envelope (project, model, requestType, sessionId) and auth headers.
import { nowSec, urlToBase64, sizeToAspectRatio } from "./_base.js";
import { getExecutor } from "../../executors/index.js";

// Antigravity accepts up to 10 reference images per request
const MAX_REFERENCE_IMAGES = 10;

// Convert image input (data URI, public URL, or raw base64) to Gemini inlineData part
async function resolveImageInput(input) {
  if (!input) return null;

  // Object format { url: ... }, { b64_json: ... }, { image_url: { url: ... } }, etc.
  if (typeof input === "object") {
    input = input.image_url?.url || input.url || input.data || input.b64_json;
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

// Collect reference images from the accepted request field shapes
function collectImageInputs(body) {
  const candidates = [
    body.reference_images,
    body.images,
    body.reference_image,
    body.image,
    body.image_url,
    body.extra_body?.image,
  ];
  return candidates
    .flatMap((v) => (Array.isArray(v) ? v : v ? [v] : []))
    .slice(0, MAX_REFERENCE_IMAGES);
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

    // Ensure we use an image model for image generation
    const isImageModel = (m) => /image|imagen|image-generation/i.test(m || "");
    let targetModel = isImageModel(model) ? model : "gemini-3.1-flash-image";

    // Aspect ratio: explicit body.aspect_ratio wins, then body.size
    let ratio = null;
    if (body.aspect_ratio && /^\d{1,2}:\d{1,2}$/.test(String(body.aspect_ratio))) {
      ratio = String(body.aspect_ratio);
    } else if (body.size && typeof body.size === "string") {
      ratio = sizeToAspectRatio(body.size);
    }
    if (ratio) {
      const suffix = ratio.replace(":", "x");
      if (!targetModel.includes(suffix)) {
        targetModel = `${targetModel}-${suffix}`;
      }
    }

    // Gemini image models have no negative prompt param — fold it into the prompt text
    const prompt = body.negative_prompt
      ? `${body.prompt}\n\nNegative prompt: ${body.negative_prompt}`
      : body.prompt;

    // Build parts: reference images first, then the text prompt
    const parts = [];
    for (const imageInput of collectImageInputs(body)) {
      const inlineData = await resolveImageInput(imageInput);
      if (inlineData) parts.push(inlineData);
    }
    if (prompt) {
      parts.push({ text: prompt });
    }

    const chatBody = {
      contents: [{ role: "user", parts }],
      ratio: body.ratio || body.aspect_ratio,
      size: body.size,
      generationConfig: body.generationConfig,
    };

    const result = await executor.execute({
      model: targetModel,
      body: chatBody,
      stream: false,
      credentials,
      log,
    });

    if (!result.response.ok) {
      const text = await result.response.text();
      const err = new Error(text || `HTTP ${result.response.status}`);
      err.status = result.response.status;
      try {
        const json = JSON.parse(text);
        const details = json.error?.details || [];
        for (const d of details) {
          const resetTimeStr = d.metadata?.quotaResetTimeStamp;
          if (resetTimeStr) {
            const ms = new Date(resetTimeStr).getTime();
            if (ms > Date.now()) {
              err.resetsAtMs = ms;
              break;
            }
          }
        }
      } catch {}
      throw err;
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
