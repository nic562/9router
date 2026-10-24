import { getModelInfo, getComboModels } from "../services/model.js";
import { getProviderCredentials } from "../services/auth.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { handleSystemoneCore } from "open-sse/handlers/systemoneCore.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { getSettings } from "@/lib/localDb";
import {
  DEFAULT_SYSTEMONE_ROUTER_MODEL,
  DEFAULT_SYSTEMONE_TIMEOUT_MS,
  extractPromptState,
  buildChoiceCriteria,
  parseSystemOneRouteAnswer,
} from "open-sse/services/systemoneRouter.js";

/**
 * Execute a single System One decision model evaluation.
 */
async function evalSingleSystemoneModel(body, modelStr, log) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo?.provider) {
    log?.warn?.("COMBO", `smart-router: unrecognized model "${modelStr}"`);
    return new Response(JSON.stringify({ error: `Unrecognized model ${modelStr}` }), { status: 400 });
  }

  const { provider, model } = modelInfo;
  const credentials = await getProviderCredentials(provider, new Set(), model, { kind: "systemone" });
  if (!credentials || credentials.allRateLimited) {
    log?.warn?.("COMBO", `smart-router: no credentials available for "${provider}/${model}"`);
    return new Response(JSON.stringify({ error: `No credentials for ${provider}` }), { status: 401 });
  }

  const refreshedCredentials = await checkAndRefreshToken(provider, credentials);
  const result = await handleSystemoneCore({
    body: { ...body, model },
    modelInfo: { provider, model },
    credentials: refreshedCredentials,
    log,
    proxyOptions: refreshedCredentials?.providerSpecificData || null,
    onRequestSuccess: () => {},
  });

  if (!result?.success || !result.response) {
    return new Response(JSON.stringify({ error: result?.error || "Upstream failure" }), { status: result?.status || 502 });
  }

  return result.response;
}

/**
 * Dispatch an in-process System One decision evaluation for a combo request.
 * Resolves the configured router model or router combo, sends the choice
 * query with a short timeout, and returns the parsed routing decision.
 *
 * Never throws: on missing credentials, timeout, or upstream failure, returns null
 * so combo dispatch fails open to standard model ordering.
 *
 * @param {object} opts
 * @param {object} opts.body - Client request body
 * @param {string[]} opts.models - Combo model candidate array
 * @param {string} [opts.routerModel] - System One router model or combo (defaults to oc/jev-1.13-free)
 * @param {object} [opts.log] - Logger
 * @param {number} [opts.timeoutMs=DEFAULT_SYSTEMONE_TIMEOUT_MS] - Hard ceiling for router evaluation
 * @returns {Promise<{ choice: string, confidence: number|null, probabilities: Record<string, number>|null } | null>}
 */
export async function resolveSmartChoice({
  body,
  models,
  routerModel = DEFAULT_SYSTEMONE_ROUTER_MODEL,
  log,
  timeoutMs = DEFAULT_SYSTEMONE_TIMEOUT_MS,
}) {
  if (!Array.isArray(models) || models.length <= 1) return null;

  const targetModel = (typeof routerModel === "string" && routerModel.trim())
    ? routerModel.trim()
    : DEFAULT_SYSTEMONE_ROUTER_MODEL;

  const state = extractPromptState(body);
  if (!state) {
    log?.info?.("COMBO", `smart-router: empty prompt state, skipping evaluation`);
    return null;
  }

  const promptSnippet = state.replace(/\s+/g, " ").slice(0, 80);
  log?.info?.("COMBO", `smart-router: evaluating [${models.join(", ")}] using "${targetModel}" | prompt: "${promptSnippet}..."`);

  const criteria = buildChoiceCriteria(models);
  if (Object.keys(criteria).length === 0) return null;

  const startTime = Date.now();

  try {
    const systemoneBody = {
      model: targetModel,
      state,
      questions: {
        route: {
          type: "choice",
          instructions: "Which of these configured models is the most appropriate for this request?",
          criteria,
        },
      },
    };

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`System One router timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const evalPromise = (async () => {
      // Check if targetModel is a combo
      const comboModels = await getComboModels(targetModel);
      if (comboModels && comboModels.length > 0) {
        const settings = await getSettings();
        const comboStrategies = settings?.comboStrategies || {};
        const comboStrategy = comboStrategies[targetModel]?.fallbackStrategy || "fallback";
        const comboStickyLimit = settings?.comboStickyRoundRobinLimit || 1;

        return handleComboChat({
          body: systemoneBody,
          models: comboModels,
          handleSingleModel: (b, m) => evalSingleSystemoneModel(b, m, log),
          log,
          comboName: targetModel,
          comboStrategy,
          comboStickyLimit,
        });
      }

      return evalSingleSystemoneModel(systemoneBody, targetModel, log);
    })();

    let response;
    try {
      response = await Promise.race([evalPromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }

    const durationMs = Date.now() - startTime;

    if (!response || !response.ok) {
      log?.warn?.("COMBO", `smart-router: evaluation returned HTTP ${response?.status || "error"} (${durationMs}ms)`);
      return null;
    }

    const json = await response.json();
    const route = parseSystemOneRouteAnswer(json);
    if (!route || !route.choice) {
      log?.warn?.("COMBO", `smart-router: response missing valid route choice (${durationMs}ms)`);
      return null;
    }

    log?.info?.("COMBO", `smart-router: decision evaluated in ${durationMs}ms -> choice: "${route.choice}" (confidence: ${route.confidence ?? "N/A"})`);
    return route;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    log?.warn?.("COMBO", `smart-router: evaluation aborted after ${durationMs}ms (${err?.message || String(err)})`);
    return null;
  }
}
