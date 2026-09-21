// Import directly from file to avoid pulling in server-side dependencies via index.js
export {
  PROVIDER_MODELS,
  getProviderModels,
  getDefaultModel,
  isValidModel as isValidModelCore,
  findModelName,
  getModelTargetFormat,
  getModelStrip,
  PROVIDER_ID_TO_ALIAS,
  getModelsByProviderId,
  getModelUpstreamId,
  getModelQuotaFamily
} from "open-sse/config/providerModels.js";

import { AI_PROVIDERS, isOpenAICompatibleProvider } from "./providers.js";
import { PROVIDER_MODELS as MODELS } from "open-sse/config/providerModels.js";

// Providers that accept any model (passthrough)
const PASSTHROUGH_PROVIDERS = new Set(
  Object.entries(AI_PROVIDERS)
    .filter(([, p]) => p.passthroughModels)
    .map(([key]) => key)
);

// Wrap isValidModel with passthrough providers
export function isValidModel(aliasOrId, modelId) {
  if (isOpenAICompatibleProvider(aliasOrId)) return true;
  if (PASSTHROUGH_PROVIDERS.has(aliasOrId)) return true;
  const models = MODELS[aliasOrId];
  if (!models) return false;
  return models.some(m => m.id === modelId);
}

// Legacy AI_MODELS for backward compatibility
export const AI_MODELS = Object.entries(MODELS).flatMap(([alias, models]) =>
  models.map(m => ({ provider: alias, model: m.id, name: m.name }))
);


export function inferModelKind(modelId) {
  if (!modelId || typeof modelId !== "string") return null;
  const id = modelId.toLowerCase();
  if (
    id.includes("gpt-image") ||
    id.includes("dall-e") ||
    id.includes("flux") ||
    id.includes("midjourney") ||
    id.includes("stable-diffusion") ||
    id.includes("sdxl") ||
    id.includes("recraft") ||
    id.includes("imagen")
  ) {
    return "image";
  }
  if (
    id.includes("embedding") ||
    id.includes("embed") ||
    id.includes("text-embedding") ||
    id.includes("bge-")
  ) {
    return "embedding";
  }
  if (
    id.includes("tts") ||
    id.includes("speech")
  ) {
    return "tts";
  }
  if (
    id.includes("whisper") ||
    id.includes("transcribe") ||
    id.includes("stt")
  ) {
    return "stt";
  }
  return null;
}

export const getModelKind = (m, fallback = null) => {
  const explicit = m?.kind || m?.type;
  if (explicit) return explicit;
  const inferred = inferModelKind(m?.id || m?.model);
  return inferred || fallback;
};

// Capacity metadata for UI badges — icon + label + color per capability.
export const CAPACITY_META = {
  vision: { icon: "visibility", label: "Vision", desc: "Supports image input", color: "text-blue-500" },
  // search: temporarily hidden (feature not wired yet)
  reasoning: { icon: "neurology", label: "Reasoning", desc: "Supports reasoning / thinking", color: "text-amber-500" },
};
