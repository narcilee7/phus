import { describe, expect, it } from "vitest";
import { asSessionId } from "@phus/core/types/brand.js";
import { makeCtx } from "@phus/core/runtime/hook/ctx-builder.js";

describe("makeCtx session field", () => {
  it("omits session when no value is provided", () => {
    const ctx = makeCtx({});
    expect(ctx.session).toBeUndefined();
    expect(ctx.sessionId).toBeUndefined();
  });

  it("propagates a SessionContextLike when provided", () => {
    const ctx = makeCtx({
      sessionId: "cli:default",
      session: { id: asSessionId("cli:default"), identityId: asSessionId("ident-1") },
    });
    expect(ctx.session).toEqual({
      id: asSessionId("cli:default"),
      identityId: asSessionId("ident-1"),
    });
    expect(ctx.sessionId).toBe(asSessionId("cli:default"));
  });
});
