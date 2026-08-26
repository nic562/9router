import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleImageGenerationCore } from "open-sse/handlers/imageGenerationCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { saveRequestUsage, saveRequestDetail, appendRequestLog } from "@/lib/usageDb.js";
import * as log from "../utils/logger.js";

// Providers that don't require credentials (noAuth)
const NO_AUTH_PROVIDERS = new Set(["sdwebui", "comfyui"]);

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
}) {
  const timestamp = new Date().toISOString();

  saveRequestUsage({
    provider: provider || "unknown",
    model: model || "unknown",
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    timestamp,
    connectionId: connectionId || undefined,
    apiKey: apiKey || undefined,
    endpoint: endpoint || "/v1/images/generations",
    status: status === "success" ? "ok" : "error",
  }).catch(() => {});

  saveRequestDetail({
    provider: provider || "unknown",
    model: model || "unknown",
    connectionId: connectionId || undefined,
    timestamp,
    latency: { total: latencyMs || 0, ttft: latencyMs || 0 },
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    request: requestBody || {},
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

  const apiKey = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!body.prompt) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");

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
          comboName: modelStr,
        }),
      log,
      comboName: modelStr,
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
  });
}

async function handleSingleModelImage(
  body,
  modelStr,
  { wantsStream, binaryOutput, preferredConnectionId, apiKey, endpoint, comboName } = {}
) {
  const reqStartTime = Date.now();
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  const recordedModelName = comboName || `${provider}/${model}`;

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
      recordUsageAndDetail({
        provider,
        model: recordedModelName,
        connectionId: "noauth",
        apiKey,
        endpoint,
        status: "success",
        latencyMs,
        requestBody: body,
        responseData: result.finalBody || {},
      });
      return result.response;
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
    });
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Image generation failed");
  }

  // Credentialed providers — fallback loop
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let lastConnectionId = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, { preferredConnectionId });

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
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      },
    });

    const latencyMs = Date.now() - reqStartTime;

    if (result.success) {
      recordUsageAndDetail({
        provider,
        model: recordedModelName,
        connectionId: credentials.connectionId,
        apiKey,
        endpoint,
        status: "success",
        latencyMs,
        requestBody: body,
        responseData: result.finalBody || {},
      });
      return result.response;
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
    });

    return result.response;
  }
}
