// apps/gui/tests/ipc-channels.test.ts
// Phase 0 sanity test — verify the IPC channel-name registry is well-formed.

import { describe, expect, it } from "vitest";
import { IpcChannels } from "../src/shared/ipc-channels.js";

describe("IpcChannels registry", () => {
  it("uses a consistent namespace prefix", () => {
    // Renderer → Main channels start with "phus:"; broadcast channels use
    // either "agent:" / "plan:" / "outbound" / "permission:" / "wizard:" /
    // "main:". Mixing prefixes in a single direction is a smell.
    const invoke = [
      IpcChannels.Turn,
      IpcChannels.Abort,
      IpcChannels.Slash,
      IpcChannels.PermissionResponse,
      IpcChannels.GetDiagnostics,
      IpcChannels.GetAllSkills,
      IpcChannels.BootstrapSubmit,
    ];
    for (const ch of invoke) {
      expect(ch.startsWith("phus:")).toBe(true);
    }
  });

  it("broadcast channels do not share names with invoke channels", () => {
    const invokeChannels = new Set<string>([
      IpcChannels.Turn,
      IpcChannels.Abort,
      IpcChannels.Slash,
      IpcChannels.PermissionResponse,
      IpcChannels.GetDiagnostics,
    ]);
    const broadcastChannels = [
      IpcChannels.AgentEvent,
      IpcChannels.PlanEvent,
      IpcChannels.Outbound,
      IpcChannels.PermissionRequest,
      IpcChannels.WizardShow,
    ];
    for (const ch of broadcastChannels) {
      expect(invokeChannels.has(ch)).toBe(false);
    }
  });

  it("has no duplicate channel names", () => {
    const values = Object.values(IpcChannels);
    expect(new Set(values).size).toBe(values.length);
  });
});