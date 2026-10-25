import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { getKeyAccessContext, enforceKeyAccess } from "../services/keyAccess.js";
import { handleImageGenerationCore } from "open-sse/handlers/imageGenerationCore.js";
import { getImageAdapter } from "open-sse/handlers/imageProviders/index.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { saveRequestUsage, saveRequestDetail, appendRequestLog } from "@/lib/usageDb.js";
import { saveBase64Image } from "@/lib/mediaStorage.js";
import * as log from "../utils/logger.js";

// Providers that don't require credentials (noAuth)
const NO_AUTH_PROVIDERS = new Set(["sdwebui", "comfyui", "veoaifree-web"]);

function recordImageRequestUsage({ provider, model, connectionId, apiKey, endpoint, usage }) {
  if (!usage || typeof usage !== "object") return;
  const promptTokens = usage.prompt_tokens;
  const completionTokens = usage.completion_tokens;
  if (!Number.isSafeInteger(promptTokens) || promptTokens < 0 ||
      !Number.isSafeInteger(completionTokens) || completionTokens < 0) {
    return;
  }

  saveRequestUsage({
    provider,
    model,
    connectionId: connectionId || undefined,
    apiKey: apiKey || undefined,
    endpoint: endpoint || null,
    tokens: usage,
    status: "success",
  }).catch(() => {});
}

function recordUsageAndDetail({
  provider,
  model,
  connectionId,
  apiKey,
  endpoint,
  status,
  latencyMs,
  requestBody,
  responseData,
  providerRequest,
  providerResponse,
  usageRecorded = false,
}) {
  const timestamp = new Date().toISOString();
  const usage = responseData?.usage || {};
  const promptTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const completionTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
  const hasTokens = (Number.isSafeInteger(promptTokens) && promptTokens > 0) ||
                    (Number.isSafeInteger(completionTokens) && completionTokens > 0);

  const tokens = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
  };

  // Avoid double-recording if onUsage already recorded provider-reported usage.
  // When usage was not reported via onUsage, only record non-zero usage if present.
  if (!usageRecorded && hasTokens) {
    saveRequestUsage({
      provider: provider || "unknown",
      model: model || "unknown",
      tokens,
      timestamp,
      connectionId: connectionId || undefined,
      apiKey: apiKey || undefined,
      endpoint: endpoint || "/v1/images/generations",
      status: status === "success" ? "success" : "error",
    }).catch(() => {});
  }

  saveRequestDetail({
    provider: provider || "unknown",
    model: model || "unknown",
    connectionId: connectionId || undefined,
    timestamp,
    latency: { total: latencyMs || 0, ttft: latencyMs || 0 },
    tokens,
    request: requestBody || {},
    providerRequest: providerRequest !== undefined ? providerRequest : null,
    providerResponse: providerResponse !== undefined ? providerResponse : null,
    response: responseData || {},
    endpoint: endpoint || "/v1/images/generations",
    status: status === "success" ? "success" : "error",
  }).catch(() => {});

  appendRequestLog(
    `[IMAGE] ${provider?.toUpperCase() || "UNKNOWN"} | ${model || "unknown"} | ${latencyMs || 0}ms | ${status}`
  );
}

/**
 * Handle image generation request
 * @param {Request} request
 */


function getPublicBaseUrl(request) {
  const configured =
    process.env.BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    "";

  if (configured) {
    return configured.trim().replace(/\/+$/, "");
  }

  try {
    const url = new URL(request.url);
    const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "") || "http";
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
    return `${proto}://${host}`;
  } catch {
    return "";
  }
}

async function persistImagesForResponse(result, formatHint, baseUrl = "") {
  if (!result?.finalBody || !Array.isArray(result.finalBody.data)) {
    return {
      clientResponse: result?.response,
      detailResponse: result?.finalBody || {},
    };
  }

  const finalBody = result.finalBody;
  const detailData = [];
  const clientData = [];
  let mutated = false;

  for (let i = 0; i < finalBody.data.length; i++) {
    const item = finalBody.data[i];
    const clientItem = { ...item };
    const detailItem = { ...item };

    if (typeof item?.b64_json === "string" && item.b64_json.length > 100) {
      try {
        const saved = await saveBase64Image({
          b64: item.b64_json,
          format: finalBody.output_format || formatHint,
          generationId: item.generation_id,
        });

        // Enrich client item if url is not present (provide full absolute url if baseUrl exists)
        if (!clientItem.url) {
          const absoluteUrl = baseUrl ? `${baseUrl}${saved.relativeUrl}` : saved.relativeUrl;
          clientItem.url = absoluteUrl;
          mutated = true;
        }

        // For observability detail: avoid storing huge base64 in SQLite
        detailItem.url = saved.relativeUrl;
        detailItem.b64_json = `[Saved to ${saved.relativeUrl}]`;
      } catch (err) {
        log.warn("IMAGE", `Failed to save image to disk: ${err?.message || err}`);
      }
    }

    clientData.push(clientItem);
    detailData.push(detailItem);
  }

  const detailBody = { ...finalBody, data: detailData };

  let clientResponse = result.response;
  if (mutated && result.response && result.response.headers?.get("content-type")?.includes("application/json")) {
    const newClientBody = { ...finalBody, data: clientData };
    clientResponse = new Response(JSON.stringify(newClientBody), {
      status: result.response.status,
      headers: result.response.headers,
    });
  }

  return { clientResponse, detailBody };
}

export async function handleImageGeneration(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const preferredConnectionId = request.headers.get("x-connection-id") || null;
  const wantsStream = (request.headers.get("accept") || "").includes("text/event-stream");
  const binaryOutput = url.searchParams.get("response_format") === "binary";
  const modelStr = body.model;
  const endpoint = url.pathname || "/v1/images/generations";
  const baseUrl = getPublicBaseUrl(request);

  const apiKey = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!body.prompt) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");

  // Per-key access control: requested target, before combo expansion.
  const keyAccessDenied = await enforceKeyAccess(await getKeyAccessContext(request), modelStr);
  if (keyAccessDenied) return keyAccessDenied;

  // Combo expansion: model may be a combo name → run fallback/round-robin across models
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    const comboStrategies = settings.comboStrategies || {};
    const comboStrategy = comboStrategies[modelStr]?.fallbackStrategy || settings.comboStrategy || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("IMAGE", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) =>
        handleSingleModelImage(b, m, {
          wantsStream,
          binaryOutput,
          preferredConnectionId,
          apiKey,
          endpoint,
          baseUrl,
        }),
      log,
      comboName: modelStr,
      signal: request?.signal,
      comboStrategy,
      comboStickyLimit,
    });
  }

  return handleSingleModelImage(body, modelStr, {
    wantsStream,
    binaryOutput,
    preferredConnectionId,
    apiKey,
    endpoint,
    baseUrl,
  });
}

async function handleSingleModelImage(
  body,
  modelStr,
  { wantsStream, binaryOutput, preferredConnectionId, apiKey, endpoint, baseUrl } = {}
) {
  const reqStartTime = Date.now();
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  const recordedModelName = model || modelStr;

  // noAuth providers — no credential needed
  if (NO_AUTH_PROVIDERS.has(provider)) {
    const result = await handleImageGenerationCore({
      body,
      modelInfo: { provider, model },
      credentials: null,
      binaryOutput,
    });
    const latencyMs = Date.now() - reqStartTime;
    if (result.success) {
      const { clientResponse, detailBody } = await persistImagesForResponse(
        result,
        body.output_format,
        baseUrl
      );
      recordUsageAndDetail({
        provider,
        model: recordedModelName,
        connectionId: "noauth",
        apiKey,
        endpoint,
        status: "success",
        latencyMs,
        requestBody: body,
        responseData: detailBody,
        providerRequest: result.providerRequest,
        providerResponse: result.providerResponse,
        usageRecorded: false,
      });
      return clientResponse;
    }
    recordUsageAndDetail({
      provider,
      model: recordedModelName,
      connectionId: "noauth",
      apiKey,
      endpoint,
      status: "error",
      latencyMs,
      requestBody: body,
      responseData: { error: result.error || "Image generation failed" },
      providerRequest: result.providerRequest,
      providerResponse: result.providerResponse,
    });
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Image generation failed");
  }

  // Credentialed providers — fallback loop
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let lastConnectionId = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, { preferredConnectionId, kind: "image" });

    if (!credentials || credentials.allRateLimited) {
      const latencyMs = Date.now() - reqStartTime;
      const errorMsg = lastError || credentials?.lastError || "Unavailable";
      const status = lastStatus || Number(credentials?.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;

      recordUsageAndDetail({
        provider,
        model: recordedModelName,
        connectionId: lastConnectionId || credentials?.connectionId,
        apiKey,
        endpoint,
        status: "error",
        latencyMs,
        requestBody: body,
        responseData: { error: errorMsg },
      });

      if (credentials?.allRateLimited) {
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    lastConnectionId = credentials.connectionId;
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    let usageRecorded = false;

    // Skip accounts the adapter knows cannot generate images (e.g. ChatGPT Free on codex)
    // without locking them: they stay usable for chat.
    const adapter = getImageAdapter(provider);
    if (adapter?.canUseCredentials && !adapter.canUseCredentials(refreshedCredentials)) {
      log.info("IMAGE", `[${provider}/${model}] skip connection ${credentials.connectionId.slice(0, 8)}: plan not entitled to image generation`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = lastError || "No account entitled to image generation (ChatGPT Free plans are not supported)";
      lastStatus = lastStatus || HTTP_STATUS.FORBIDDEN;
      continue;
    }
    const result = await handleImageGenerationCore({
      body,
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      streamToClient: wantsStream,
      binaryOutput,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active",
        });
      },
      onUsage: (usage) => {
        usageRecorded = true;
        recordImageRequestUsage({
          provider,
          model,
          connectionId: credentials.connectionId,
          apiKey,
          endpoint,
          usage,
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
        // Cookies that rotate on use (Clerk `__client`) are mutated in place by
        // the executor — persist the new value so the chain does not drift.
        if (refreshedCredentials.apiKey && refreshedCredentials.apiKey !== credentials.apiKey) {
          await updateProviderCredentials(credentials.connectionId, { apiKey: refreshedCredentials.apiKey });
        }
      },
    });

    const latencyMs = Date.now() - reqStartTime;

    if (result.success) {
      const { clientResponse, detailBody } = await persistImagesForResponse(
        result,
        body.output_format,
        baseUrl
      );
      recordUsageAndDetail({
        provider,
        model: recordedModelName,
        connectionId: credentials.connectionId,
        apiKey,
        endpoint,
        status: "success",
        latencyMs,
        requestBody: body,
        responseData: detailBody,
        providerRequest: result.providerRequest,
        providerResponse: result.providerResponse,
        usageRecorded,
      });
      return clientResponse;
    }

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model);

    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    recordUsageAndDetail({
      provider,
      model: recordedModelName,
      connectionId: credentials.connectionId,
      apiKey,
      endpoint,
      status: "error",
      latencyMs,
      requestBody: body,
      responseData: { error: result.error },
      providerRequest: result.providerRequest,
      providerResponse: result.providerResponse,
    });

    return result.response;
  }
}
