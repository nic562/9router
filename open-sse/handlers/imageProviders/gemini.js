// Google Gemini adapter (Nano Banana / Gemini Flash Image models)
import { nowSec, urlToBase64 } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const BASE_URL = PROVIDER_MEDIA["gemini"]?.imageConfig?.baseUrl;

// Convert image input (data URI, public URL, or raw base64) to Gemini inlineData part
async function resolveImageInput(input) {
  if (!input) return null;

  if (typeof input === "object") {
    if (input.url) input = input.url;
    else if (input.b64_json) input = input.b64_json;
  }

  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const b64 = await urlToBase64(trimmed);
      return { inlineData: { mimeType: "image/png", data: b64 } };
    } catch {
      return null;
    }
  }

  const dataUriMatch = trimmed.match(/^data:(image\/[^;]+);base64,(.+)$/i);
  if (dataUriMatch) {
    return { inlineData: { mimeType: dataUriMatch[1], data: dataUriMatch[2] } };
  }

  if (/^[A-Za-z0-9+/=]/.test(trimmed) && trimmed.length > 50) {
    return { inlineData: { mimeType: "image/png", data: trimmed } };
  }

  return null;
}

function extractInputImages(body) {
  const images = [];
  if (Array.isArray(body.extra_body?.image)) images.push(...body.extra_body.image);
  else if (body.extra_body?.image) images.push(body.extra_body.image);

  if (Array.isArray(body.images)) images.push(...body.images);
  if (body.image) images.push(body.image);
  if (body.image_url) images.push(body.image_url);
  return images.filter(Boolean);
}

function parseImageConfig(body, model) {
  const config = {};

  const rawRatio = body?.ratio || body?.aspect_ratio || body?.generationConfig?.imageConfig?.aspectRatio;
  if (rawRatio && rawRatio !== "auto") {
    config.aspectRatio = String(rawRatio).replace("x", ":");
  }

  const rawSize = body?.size || body?.generationConfig?.imageConfig?.imageSize || body?.imageSize;
  if (rawSize && ["1K", "2K", "4K"].includes(String(rawSize).toUpperCase())) {
    config.imageSize = String(rawSize).toUpperCase();
  } else if (rawSize && /^(\d+)x(\d+)$/.test(String(rawSize))) {
    const [_, wStr, hStr] = String(rawSize).match(/^(\d+)x(\d+)$/);
    const w = Number(wStr);
    const h = Number(hStr);
    if (!config.aspectRatio) {
      const gcd = (a, b) => (b ? gcd(b, a % b) : a);
      const d = gcd(w, h);
      config.aspectRatio = `${w / d}:${h / d}`;
    }
  }

  if (!config.aspectRatio && model) {
    const resMatch = model.match(/(\d+)x(\d+)$/);
    if (resMatch) {
      const w = parseInt(resMatch[1]);
      const h = parseInt(resMatch[2]);
      if (w <= 16 && h <= 16) {
        config.aspectRatio = `${w}:${h}`;
      } else {
        const gcd = (a, b) => (b ? gcd(b, a % b) : a);
        const d = gcd(w, h);
        config.aspectRatio = `${w / d}:${h / d}`;
      }
    }
  }

  if (!config.aspectRatio) {
    config.aspectRatio = "1:1";
  }

  return config;
}

export default {
  buildUrl: (model, creds) => {
    const apiKey = creds?.apiKey || creds?.accessToken;
    const modelId = model.replace(/^models\//, "");
    return `${BASE_URL}/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;
  },
  buildHeaders: () => ({ "Content-Type": "application/json" }),
  buildBody: async (model, body) => {
    const parts = [];

    const rawImages = extractInputImages(body);
    for (const img of rawImages) {
      const inlineData = await resolveImageInput(img);
      if (inlineData) parts.push(inlineData);
    }

    if (body.prompt) {
      parts.push({ text: body.prompt });
    }

    const imageConfig = parseImageConfig(body, model);

    const generationConfig = {
      responseModalities: ["TEXT", "IMAGE"],
      ...(body.generationConfig || {}),
      imageConfig: {
        ...imageConfig,
        ...(body.generationConfig?.imageConfig || {}),
      },
    };

    return {
      contents: [{ parts }],
      generationConfig,
    };
  },
  normalize: (responseBody, prompt) => {
    const parts = responseBody.candidates?.[0]?.content?.parts || [];
    const images = parts.filter((p) => p.inlineData?.data).map((p) => ({ b64_json: p.inlineData.data }));
    return {
      created: nowSec(),
      data: images.length > 0 ? images : [{ b64_json: "", revised_prompt: prompt }],
    };
  },
};
