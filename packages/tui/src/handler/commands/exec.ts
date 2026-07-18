// src/tui/handler/commands/exec.ts
// Direct shell + file access without an AI roundtrip. /bash runs an
// arbitrary shell command; /read shows a file's contents.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { BASH_TIMEOUT_MS } from "@/constants.js";
import type { CommandRegistry } from "@/handler/commands/context.js";
import { errorMessage, notify } from "@/handler/commands/notice.js";

const execFileP = promisify(execFile);

export function registerExec(): CommandRegistry {
  return {
    async bash(arg, { dispatch }) {
      if (!arg) {
        notify(dispatch, "usage: /bash <command>", "warn");
        return;
      }
      dispatch({ type: "set_busy", busy: true });
      dispatch({ type: "set_last_op", op: "bash…" });
      try {
        const out = await execFileP("sh", ["-c", arg], { timeout: BASH_TIMEOUT_MS });
        notify(
          dispatch,
          `$ ${arg}\n${(out.stdout ?? "") + (out.stderr ?? "")}`.trimEnd(),
        );
      } catch (err) {
        notify(dispatch, `bash failed: ${errorMessage(err)}`, "error");
      } finally {
        dispatch({ type: "set_busy", busy: false });
        dispatch({ type: "set_last_op", op: "idle" });
      }
    },

    async read(arg, { dispatch }) {
      if (!arg) {
        notify(dispatch, "usage: /read <path>", "warn");
        return;
      }
      try {
        const text = await readFile(arg, "utf-8");
        notify(dispatch, `── ${arg} (${text.length} chars) ──\n${text}`);
      } catch (err) {
        notify(dispatch, `read failed: ${errorMessage(err)}`, "error");
      }
    },
  };
}
