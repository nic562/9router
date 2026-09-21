// Custom node providers (openai-compatible-*) — baseUrl from credentials
// Automatically routes to /images/edits when reference images are present, else /images/generations
import createOpenAIAdapter from "./openai.js";
import { urlToBase64 } from "./_base.js";

const baseAdapter = createOpenAIAdapter("openai");

function extractInputImages(body) {
  const images = [];
  if (Array.isArray(body.extra_body?.image)) images.push(...body.extra_body.image);
  else if (typeof body.extra_body?.image === "string" && body.extra_body.image.trim()) images.push(body.extra_body.image.trim());

  if (Array.isArray(body.images)) {
    for (const item of body.images) {
      if (typeof item === "string" && item.trim()) images.push(item.trim());
      else if (item?.url) images.push(item.url);
    }
  }
  if (typeof body.image === "string" && body.image.trim()) images.push(body.image.trim());
  else if (body.image?.url) images.push(body.image.url);
  if (typeof body.image_url === "string" && body.image_url.trim()) images.push(body.image_url.trim());
  else if (body.image_url?.url) images.push(body.image_url.url);

  return [...new Set(images.filter(Boolean))];
}

async function imageInputToBlob(input, defaultFilename = "image.png") {
  if (!input) return null;
  if (typeof input === "object") {
    if (input.url) input = input.url;
    else if (input.b64_json) input = input.b64_json;
  }
  if (typeof input !== "string") return null;
  const str = input.trim();

  // Data URI: data:image/png;base64,...
  const dataUriMatch = str.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUriMatch) {
    const mime = dataUriMatch[1];
    const buf = Buffer.from(dataUriMatch[2], "base64");
    const ext = mime.split("/")[1] || "png";
    return new Blob([buf], { type: mime });
  }

  // HTTP URL: fetch and convert to blob
  if (/^https?:\/\//i.test(str)) {
    try {
      const res = await fetch(str);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const mime = res.headers.get("content-type") || "image/png";
        return new Blob([buf], { type: mime });
      }
    } catch {}
  }

  // Pure Base64 string
  if (/^[A-Za-z0-9+/=]+$/.test(str) && str.length > 50) {
    const buf = Buffer.from(str, "base64");
    return new Blob([buf], { type: "image/png" });
  }

  return null;
}

function resolveBaseEndpoint(creds) {
  const rawBaseUrl = creds?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
  return rawBaseUrl
    .replace(/\/$/, "")
    .replace(/\/images\/generations$/, "")
    .replace(/\/images\/edits$/, "")
    .replace(/\/images$/, "");
}

export default {
  ...baseAdapter,

  buildUrl: (_model, creds, body) => {
    const baseUrl = resolveBaseEndpoint(creds);
    const inputImages = extractInputImages(body || {});
    if (inputImages.length > 0) {
      return `${baseUrl}/images/edits`;
    }
    return `${baseUrl}/images/generations`;
  },

  buildHeaders: (creds, requestBody) => {
    const headers = {};
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers["Authorization"] = `Bearer ${key}`;

    // When requestBody is FormData, omit Content-Type so fetch sets boundary automatically
    if (typeof FormData !== "undefined" && requestBody instanceof FormData) {
      return headers;
    }

    headers["Content-Type"] = "application/json";
    return headers;
  },

  buildBody: async (model, body) => {
    const inputImages = extractInputImages(body || {});

    // If no reference images, use standard JSON generations payload
    if (inputImages.length === 0) {
      return baseAdapter.buildBody(model, body);
    }

    // Reference images present -> construct multipart/form-data for /images/edits
    const formData = new FormData();
    formData.append("model", model);
    if (body.prompt) formData.append("prompt", body.prompt);
    if (body.n) formData.append("n", String(body.n));
    if (body.size) formData.append("size", String(body.size));
    if (body.quality) formData.append("quality", String(body.quality));
    if (body.response_format) formData.append("response_format", String(body.response_format));
    if (body.background) formData.append("background", String(body.background));
    if (body.output_format) formData.append("output_format", String(body.output_format));

    // Convert reference images to Blob and append to form
    for (let i = 0; i < inputImages.length; i++) {
      const blob = await imageInputToBlob(inputImages[i], `ref_${i}.png`);
      if (blob) {
        // OpenAI standard edits parameter is 'image' (or 'image[]' for multi-image)
        if (i === 0) {
          formData.append("image", blob, "image.png");
        } else {
          formData.append("image", blob, `image_${i}.png`);
        }
      }
    }

    // In case target relay accepts mask
    if (body.mask) {
      const maskBlob = await imageInputToBlob(body.mask, "mask.png");
      if (maskBlob) formData.append("mask", maskBlob, "mask.png");
    }

    return formData;
  },
};
