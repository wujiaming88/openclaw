import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { log } from "./logger.js";
import { resolveFastModeParam } from "../fast-mode.js";

// ---------------------------------------------------------------------------
// Volcengine (火山引擎) / BytePlus Fast Mode Wrapper
//
// Both providers use the ARK API which is OpenAI Chat Completions compatible
// (api: "openai-completions"). This wrapper injects low-latency parameters
// when fast mode is enabled.
// ---------------------------------------------------------------------------

/** All Volcengine / BytePlus provider identifiers. */
const VOLCENGINE_PROVIDERS = new Set([
  "volcengine",
  "volcengine-plan",
  "byteplus",
  "byteplus-plan",
]);

/** Known Volcengine / BytePlus ARK API hostnames. */
function isVolcenginePublicApiBaseUrl(baseUrl: unknown): boolean {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    return false;
  }

  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return (
      host.endsWith(".volces.com") || // Volcengine CN: ark.cn-beijing.volces.com
      host.endsWith(".bytepluses.com") // BytePlus: ark.ap-southeast.bytepluses.com
    );
  } catch {
    const normalized = baseUrl.toLowerCase();
    return normalized.includes("volces.com") || normalized.includes("bytepluses.com");
  }
}

/**
 * Apply fast mode payload overrides for Volcengine / BytePlus ARK API.
 *
 * The ARK API is OpenAI Chat Completions compatible, so we inject parameters
 * following the same conventions:
 *
 * 1. `stream_options.chunk_result` — request chunked streaming for lower TTFT
 * 2. Lower `max_tokens` cap — reduce generation length for faster responses
 * 3. `temperature` nudge — slightly lower temperature for more deterministic (faster) output
 *
 * All injections respect the `=== undefined` guard: user-explicit values are never overridden.
 */
function applyVolcengineFastModePayloadOverrides(payloadObj: Record<string, unknown>): void {
  // 1. Request chunked streaming for lower time-to-first-token
  if (payloadObj.stream_options === undefined) {
    payloadObj.stream_options = { chunk_result: true };
  }

  // 2. Cap max_tokens if not explicitly set (reduce generation overhead)
  // Only apply if the current value is unset or very large
  if (payloadObj.max_tokens === undefined) {
    payloadObj.max_tokens = 4096;
  }

  // 3. Slightly lower temperature for more deterministic responses
  if (payloadObj.temperature === undefined) {
    payloadObj.temperature = 0.3;
  }
}

/**
 * Resolve whether Volcengine / BytePlus fast mode should be applied.
 *
 * Reads from the shared `fastMode` / `fast_mode` extra params, reusing the
 * same resolution logic as OpenAI and Anthropic fast mode.
 */
export function resolveVolcengineFastMode(
  extraParams: Record<string, unknown> | undefined,
): boolean | undefined {
  return resolveFastModeParam(extraParams);
}

/**
 * Check whether a provider is a Volcengine / BytePlus provider.
 */
export function isVolcengineProvider(provider: string): boolean {
  return VOLCENGINE_PROVIDERS.has(provider);
}

/**
 * Create a stream wrapper that injects Volcengine / BytePlus fast mode
 * parameters into the API payload.
 *
 * Guard conditions (all must be true):
 * - `model.api` is `"openai-completions"` (ARK API)
 * - `model.provider` is one of the Volcengine / BytePlus providers
 * - `model.baseUrl` points to a known Volcengine / BytePlus endpoint
 *
 * When fast mode is disabled (`enabled=false`), the wrapper is a no-op passthrough.
 */
export function createVolcengineFastModeWrapper(
  baseStreamFn: StreamFn | undefined,
  enabled: boolean,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;

  if (!enabled) {
    return underlying;
  }

  return (model, context, options) => {
    // Guard: only apply to Volcengine/BytePlus + openai-completions API
    if (
      model.api !== "openai-completions" ||
      typeof model.provider !== "string" ||
      !VOLCENGINE_PROVIDERS.has(model.provider) ||
      !isVolcenginePublicApiBaseUrl(model.baseUrl)
    ) {
      return underlying(model, context, options);
    }

    const originalOnPayload = options?.onPayload;
    return underlying(model, context, {
      ...options,
      onPayload: (payload) => {
        if (payload && typeof payload === "object") {
          applyVolcengineFastModePayloadOverrides(payload as Record<string, unknown>);
        }
        return originalOnPayload?.(payload, model);
      },
    });
  };
}
