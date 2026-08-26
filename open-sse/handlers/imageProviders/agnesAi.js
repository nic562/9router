// Agnes-AI Image adapter (supports agnes-image-2.0-flash and agnes-image-2.1-flash)
// Docs: https://www.agnes-ai.com/zh-Hans/docs/agnes-image-20-flash
//       https://www.agnes-ai.com/zh-Hans/docs/agnes-image-21-flash
import { PROVIDER_MEDIA } from "../../providers/index.js";
import { nowSec } from "./_base.js";

const imageCfg = () => PROVIDER_MEDIA["agnes-ai"]?.imageConfig || {};
const imageUrl = () => imageCfg().baseUrl || "https://apihub.agnes-ai.com/v1/images/generations";

// Standard output dimensions per ratio for 1K tier (Agnes Image 2.1 mapping)
const RATIO_TO_SIZE_1K = {
  "1:1": "1024x1024",
  "3:4": "864x1152",
  "4:3": "1152x864",
  "16:9": "1312x736",
  "9:16": "736x1312",
  "2:3": "832x1248",
  "3:2": "1248x832",
  "21:9": "1568x672",
};

function extractInputImages(body) {
  const images = [];

  // Check extra_body.image first
  if (Array.isArray(body.extra_body?.image)) {
    images.push(...body.extra_body.image);
  } else if (typeof body.extra_body?.image === "string" && body.extra_body.image.trim()) {
    images.push(body.extra_body.image.trim());
  }

  // Top-level image / images / image_url
  if (Array.isArray(body.images)) {
    for (const item of body.images) {
      if (typeof item === "string" && item.trim()) images.push(item.trim());
      else if (item?.url) images.push(item.url);
    }
  }

  if (typeof body.image === "string" && body.image.trim()) {
    images.push(body.image.trim());
  } else if (body.image?.url) {
    images.push(body.image.url);
  }

  if (typeof body.image_url === "string" && body.image_url.trim()) {
    images.push(body.image_url.trim());
  } else if (body.image_url?.url) {
    images.push(body.image_url.url);
  }

  // Filter unique non-empty strings
  return [...new Set(images.filter(Boolean))];
}

export default {
  buildUrl: () => imageUrl(),
  buildHeaders: (creds) => {
    const headers = { "Content-Type": "application/json" };
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers["Authorization"] = `Bearer ${key}`;
    return headers;
  },
  buildBody: (model, body) => {
    const { prompt } = body;
    const modelName = model || "agnes-image-2.0-flash";
    const is21 = modelName.includes("2.1");
    const rawRatio = body.ratio || body.aspect_ratio;
    const ratio = rawRatio && rawRatio !== "auto" ? rawRatio : null;
    let size = body.size;

    const req = {
      model: modelName,
      prompt,
    };

    if (is21) {
      // === Agnes Image 2.1 Flash ===
      // Supports size tiers: "1K", "2K", "3K", "4K" and ratio: "1:1", "3:4", "4:3", "16:9", etc.
      // Also backwards compatible with exact dimensions like "1024x1024"
      if (ratio) {
        req.ratio = ratio;
        if (size && ["1K", "2K", "3K", "4K"].includes(String(size).toUpperCase())) {
          req.size = String(size).toUpperCase();
        } else if (size && size !== "auto" && !size.includes("x")) {
          req.size = size;
        }
      } else {
        if (!size || size === "auto") {
          req.size = "1024x1024";
        } else {
          req.size = size;
        }
      }
    } else {
      // === Agnes Image 2.0 Flash ===
      // Only accepts exact pixel dimensions in "size" (e.g. "1024x768", "1024x1024", "768x1024").
      // Does NOT support "ratio" or "1K"/"2K" tier strings.
      if (ratio && (!size || size === "auto" || ["1K", "2K", "3K", "4K"].includes(String(size).toUpperCase()))) {
        req.size = RATIO_TO_SIZE_1K[ratio] || "1024x1024";
      } else if (size && ["1K", "2K", "3K", "4K"].includes(String(size).toUpperCase())) {
        req.size = "1024x1024";
      } else if (size && size !== "auto") {
        req.size = size;
      } else {
        req.size = "1024x1024";
      }
    }

    // Determine response format (url vs b64_json)
    const responseFormat = body.extra_body?.response_format || body.response_format;
    if (responseFormat === "b64_json") {
      req.return_base64 = true;
    }

    // Extra body: Agnes-AI requires response_format and image inside extra_body
    const extraBody = { ...(body.extra_body || {}) };
    if (responseFormat) {
      extraBody.response_format = responseFormat;
    }

    const inputImages = extractInputImages(body);
    if (inputImages.length > 0) {
      extraBody.image = inputImages;
    }

    if (Object.keys(extraBody).length > 0) {
      req.extra_body = extraBody;
    }

    return req;
  },
  normalize: (responseBody, prompt) => {
    if (responseBody?.data && Array.isArray(responseBody.data)) {
      return {
        created: responseBody.created || nowSec(),
        data: responseBody.data.map((item) => ({
          url: item.url || null,
          b64_json: item.b64_json || null,
          revised_prompt: item.revised_prompt || prompt || null,
        })),
      };
    }
    return responseBody;
  },
};
