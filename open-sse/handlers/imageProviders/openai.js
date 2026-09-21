// OpenAI-compatible adapter (used by openai, minimax, openrouter, recraft, custom nodes)
import { PROVIDER_MEDIA } from "../../providers/index.js";

const imageCfg = (id) => PROVIDER_MEDIA[id]?.imageConfig || {};
const imageUrl = (id) => imageCfg(id).baseUrl;

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

export default function createOpenAIAdapter(providerId) {
  const cfg = imageCfg(providerId);
  return {
    buildUrl: () => imageUrl(providerId),
    buildHeaders: (creds) => {
      const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };
      const key = creds?.apiKey || creds?.accessToken;
      if (key) headers["Authorization"] = `Bearer ${key}`;
      return headers;
    },
    buildBody: (model, body) => {
      const { prompt, n = 1, size = "1024x1024", quality, style, response_format, background, output_format, seed, user } = body;
      const full = { model, prompt, n, size };
      if (quality) full.quality = quality;
      if (style) full.style = style;
      if (response_format) full.response_format = response_format;
      if (background) full.background = background;
      if (output_format) full.output_format = output_format;
      if (seed !== undefined) full.seed = seed;
      if (user) full.user = user;

      // Extract reference images for image-to-image (img2img)
      const inputImages = extractInputImages(body);
      if (inputImages.length > 0) {
        full.images = inputImages;
        full.image = inputImages[0];
        full.extra_body = { ...(body.extra_body || {}), image: inputImages };
      }

      // Pass through any other caller-provided params (e.g. moderation, prompt_enhancement)
      for (const [k, v] of Object.entries(body)) {
        if (full[k] === undefined && v !== undefined) {
          full[k] = v;
        }
      }

      // bodyFields whitelist (e.g. xAI accepts only model/prompt/n/response_format)
      if (Array.isArray(cfg.bodyFields)) {
        const req = {};
        for (const f of cfg.bodyFields) if (full[f] !== undefined) req[f] = full[f];
        return req;
      }
      return full;
    },
    normalize: (responseBody) => responseBody,
  };
}
