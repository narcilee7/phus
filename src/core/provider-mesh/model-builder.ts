// src/core/provider-mesh/model-builder.ts
// Adapts an `EndpointSpec` into a Pi-compatible `Model`.

import { getModel, type Model } from "@mariozechner/pi-ai";
import type { EndpointSpec } from "./types.js";

/** Build a Pi `Model` from an endpoint spec, applying any wire-format
 *  overrides (baseUrl, modelId). Pure: no side effects on the spec. */
export function endpointToModel(ep: EndpointSpec): Model<any> {
  const base = getModel(ep.provider as any, ep.modelId as any);
  const overrides: Partial<Model<any>> = {};
  if (ep.baseUrl) overrides.baseUrl = ep.baseUrl;
  if (ep.modelId) overrides.id = ep.modelId;
  return Object.keys(overrides).length > 0 ? { ...base, ...overrides } : base;
}