// Agnes-AI Image adapter (supports agnes-image-2.0-flash and agnes-image-2.1-flash)
// Docs: https://www.agnes-ai.com/zh-Hans/docs/agnes-image-20-flash
//       https://www.agnes-ai.com/zh-Hans/docs/agnes-image-21-flash
import { PROVIDER_MEDIA } from "../../providers/index.js";
import { nowSec } from "./_base.js";

const imageCfg = () => PROVIDER_MEDIA["agnes-ai"]?.imageConfig || {};
const imageUrl = () => imageCfg().baseUrl || "https://apihub.agnes-ai.com/v1/images/generations";

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
    let size = body.size;
    if (!size || size === "auto") {
      size = "1024x1024";
    }

    const req = {
      model: model || "agnes-image-2.0-flash",
      prompt,
      size,
    };

    // ratio (supported by 2.1-flash and flexible size workflows)
    const ratio = body.ratio || body.aspect_ratio;
    if (ratio && ratio !== "auto") {
      req.ratio = ratio;
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
