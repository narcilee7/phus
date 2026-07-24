import { afterEach, describe, expect, it } from "vitest";
import { SessionStorage } from "../src/session/session-storage.js";
import { SessionIdentityStore, IdentityMergeConflictError } from "../src/session/session-identity.js";

let storage: SessionStorage | undefined;
let store: SessionIdentityStore | undefined;

afterEach(() => {
  store?.dispose();
  storage?.close();
  store = undefined;
  storage = undefined;
});

function open(): { storage: SessionStorage; store: SessionIdentityStore } {
  storage = new SessionStorage(":memory:");
  store = new SessionIdentityStore(storage);
  return { storage, store };
}

describe("SessionIdentityStore", () => {
  it("creates an identity for a new subject", () => {
    const { store } = open();
    const identity = store.getOrCreateBySubject("telegram", "user-1", "alice");
    expect(identity.primaryChannel).toBe("telegram");
    expect(identity.primarySubjectId).toBe("user-1");
    expect(identity.displayName).toBe("alice");
  });

  it("is idempotent for the same subject", () => {
    const { store } = open();
    const first = store.getOrCreateBySubject("telegram", "user-1", "alice");
    const second = store.getOrCreateBySubject("telegram", "user-1", "alice");
    expect(second.id).toBe(first.id);
  });

  it("updates displayName when a different one is supplied", () => {
    const { store } = open();
    const first = store.getOrCreateBySubject("telegram", "user-1", "alice");
    const second = store.getOrCreateBySubject("telegram", "user-1", "Alice!");
    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe("Alice!");
  });

  it("throws on conflict when a subject is linked to a different identity", () => {
    const { store } = open();
    const first = store.getOrCreateBySubject("telegram", "user-1", "alice");
    const second = store.getOrCreateBySubject("slack", "user-1", "alice2");
    expect(() => store.linkSubject(first.id, "slack", "user-1"))
      .toThrow(IdentityMergeConflictError);
  });
});
