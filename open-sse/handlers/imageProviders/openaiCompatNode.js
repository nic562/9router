// Custom node providers (openai-compatible-*) — baseUrl from credentials
import createOpenAIAdapter from "./openai.js";

const baseAdapter = createOpenAIAdapter("openai");

export default {
  ...baseAdapter,
  buildUrl: (_model, creds) => {
    const rawBaseUrl = creds?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
    const baseUrl = rawBaseUrl.replace(/\/$/, "").replace(/\/images\/generations$/, "").replace(/\/images$/, "");
    return `${baseUrl}/images/generations`;
  },
};
