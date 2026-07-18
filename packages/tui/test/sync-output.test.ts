// test/tui/sync-output.test.ts
// Verifies the CSI 2026 wrappers bracket every stdout.write with the
// begin/end markers, and that uninstallSyncOutput restores the original.

import { describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import { installSyncOutput, withSyncOutput } from "../../src/tui/runtime/sync-output.js";

function makeStdout(): NodeJS.WriteStream & { chunks: string[] } {
	const chunks: string[] = [];
	const sink = new Writable({
		write(chunk, _enc, cb) {
			chunks.push(String(chunk));
			cb();
		},
	});
	// Cast: we only need write(); the rest of WriteStream isn't used here.
	return Object.assign(sink as unknown as NodeJS.WriteStream, { chunks });
}

describe("withSyncOutput", () => {
	it("wraps the block in CSI 2026 begin/end markers", () => {
		const stdout = makeStdout();
		withSyncOutput(stdout, () => {
			stdout.write("hello");
		});
		expect(stdout.chunks).toEqual(["\x1b[?2026h", "hello", "\x1b[?2026l"]);
	});

	it("emits the end marker even when fn throws", () => {
		const stdout = makeStdout();
		expect(() =>
			withSyncOutput(stdout, () => {
				throw new Error("boom");
			}),
		).toThrow("boom");
		expect(stdout.chunks).toEqual(["\x1b[?2026h", "\x1b[?2026l"]);
	});
});

describe("installSyncOutput", () => {
	it("wraps every write call after install", () => {
		const stdout = makeStdout();
		const uninstall = installSyncOutput(stdout);
		stdout.write("a");
		stdout.write("b");
		uninstall();
		expect(stdout.chunks).toEqual([
			"\x1b[?2026h",
			"a",
			"\x1b[?2026l",
			"\x1b[?2026h",
			"b",
			"\x1b[?2026l",
		]);
	});

	it("restores the original write after uninstall", () => {
		const stdout = makeStdout();
		const uninstall = installSyncOutput(stdout);
		stdout.write("installed");
		uninstall();
		// After uninstall, a fresh write must NOT be wrapped in CSI 2026.
		stdout.write("after");
		expect(stdout.chunks).toEqual([
			"\x1b[?2026h",
			"installed",
			"\x1b[?2026l",
			"after",
		]);
	});
});