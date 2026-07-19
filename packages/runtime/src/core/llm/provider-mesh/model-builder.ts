// src/core/provider-mesh/model-builder.ts
// Adapts an `EndpointSpec` into a Pi-compatible `Model`.

import type { Model } from "@mariozechner/pi-ai";
import type { EndpointSpec } from "./types.js";
import { resolveAndCache } from "@/infra/config/index.js";

/** Build a Pi `Model` from an endpoint spec, applying any wire-format
 *  overrides (baseUrl, wireId). Delegates to `resolveAndCache()` so
 *  the result is cached and validated at config-load time. Custom
 *  OpenAI-compatible gateways (modelIds not in Pi's registry) get a
 *  synthesized stub Model — no more silent `{ ...undefined }`. */
export function endpointToModel(ep: EndpointSpec): Model<any> {
  const wireId = ep.wireId ?? ep.modelId;
  const { model: base } = resolveAndCache({
    provider: ep.provider,
    modelId: ep.modelId,
    baseUrl: ep.baseUrl,
    overrideId: wireId,
  });
  const overrides: Partial<Model<any>> = {};
  if (ep.baseUrl) overrides.baseUrl = ep.baseUrl;
  if (wireId !== ep.modelId) {
    overrides.id = wireId;
    // Gateway proxies (Volcano Ark, etc.) may not support the native
    // thinking/reasoning API. Disable reasoning so Pi doesn't send
    // unsupported parameters like `thinking: { type: "disabled" }`.
    overrides.reasoning = false;
  }
  return Object.keys(overrides).length > 0 ? { ...base, ...overrides } : base;
}