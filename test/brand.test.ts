// test/brand.test.ts
import { describe, expect, it } from "vitest";
import {
  asSessionId,
  asToolCallId,
  asTurnId,
  asScheduleName,
  asOptionalSessionId,
  asOptionalTurnId,
  type SessionId,
  type ToolCallId,
  type TurnId,
  type ScheduleName,
} from "../src/types/brand.js";

describe("brand helpers", () => {
  it("cast helpers preserve the runtime string", () => {
    const s = "user-42";
    expect(asSessionId(s)).toBe(s);
    expect(asToolCallId(s)).toBe(s);
    expect(asTurnId(s)).toBe(s);
    expect(asScheduleName(s)).toBe(s);
  });

  it("branded types are not assignable to each other at compile time", () => {
    const sid = asSessionId("user-42");
    // @ts-expect-error SessionId cannot flow into ToolCallId
    const tcid: ToolCallId = sid;
    expect(tcid).toBeDefined(); // silence noUnused
  });

  it("branded types are assignable to plain string (covariant)", () => {
    const sid: SessionId = asSessionId("user-42");
    const raw: string = sid;
    expect(raw).toBe("user-42");
  });

  it("asOptionalSessionId returns undefined for empty input", () => {
    expect(asOptionalSessionId(undefined)).toBeUndefined();
    expect(asOptionalSessionId("")).toBeUndefined();
    const sid = asOptionalSessionId("real");
    expect(sid).toBeTypeOf("string");
    expect(sid).toBe("real");
  });

  it("asOptionalTurnId returns undefined for empty input", () => {
    expect(asOptionalTurnId(undefined)).toBeUndefined();
    expect(asOptionalTurnId("")).toBeUndefined();
    const tid: TurnId | undefined = asOptionalTurnId("turn-7");
    expect(tid).toBe("turn-7");
  });

  it("ScheduleName brand prevents accidentally passing a sessionId", () => {
    const sname: ScheduleName = asScheduleName("nightly-cleanup");
    // @ts-expect-error SessionId cannot flow into ScheduleName
    const wrong: ScheduleName = sname as unknown as SessionId;
    expect(wrong).toBeDefined();
  });
});