import { describe, expect, it } from "vitest";
import { deriveEmailThreadRootId } from "../src/channels/email.js";

describe("deriveEmailThreadRootId", () => {
  it("prefers references[0] over inReplyTo and messageId", () => {
    expect(
      deriveEmailThreadRootId({
        messageId: "m3",
        inReplyTo: "m2",
        references: ["m1", "m2"],
      }),
    ).toBe("m1");
  });

  it("falls back to inReplyTo when references is missing", () => {
    expect(
      deriveEmailThreadRootId({
        messageId: "m3",
        inReplyTo: "m2",
      }),
    ).toBe("m2");
  });

  it("falls back to messageId when neither references nor inReplyTo are present", () => {
    expect(deriveEmailThreadRootId({ messageId: "m1" })).toBe("m1");
  });

  it("returns an empty string when nothing is provided", () => {
    expect(deriveEmailThreadRootId({})).toBe("");
  });

  it("ignores empty references arrays", () => {
    expect(deriveEmailThreadRootId({ messageId: "m1", references: [] })).toBe("m1");
  });
});
