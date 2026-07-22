// test/stdin-buffer-paste.test.ts
// Verify the vendored StdinBuffer correctly reassembles bracketed-paste
// payloads that arrive across multiple stdin chunks. The BootstrapWizard
// and KeyWizard rely on the terminal layer emitting ONE
// `\x1b[200~...\x1b[201~` payload per paste — if the buffer leaks the
// START chunk as raw input it gets dropped by the wizard's
// `!data.startsWith("\x1b")` guard.

import { describe, expect, it } from "vitest";
import { StdinBuffer } from "../src/vendor/pi-tui/stdin-buffer.js";

describe("StdinBuffer paste reassembly", () => {
	it("emits a single 'paste' event when the full payload arrives in one chunk", () => {
		const buf = new StdinBuffer({ timeout: 50 });
		const pasteEvents: string[] = [];
		const dataEvents: string[] = [];
		buf.on("paste", (c) => pasteEvents.push(c));
		buf.on("data", (c) => dataEvents.push(c));

		buf.process("\x1b[200~sk-ant-fake-key\x1b[201~");

		expect(pasteEvents).toEqual(["sk-ant-fake-key"]);
		expect(dataEvents).toEqual([]);
	});

	it("accumulates across chunks split inside the payload body", () => {
		const buf = new StdinBuffer({ timeout: 50 });
		const pasteEvents: string[] = [];
		const dataEvents: string[] = [];
		buf.on("paste", (c) => pasteEvents.push(c));
		buf.on("data", (c) => dataEvents.push(c));

		// Simulate a terminal driver splitting one long paste into two
		// reads at an arbitrary byte boundary inside the body.
		buf.process("\x1b[200~sk-ant-fake-key");
		buf.process("_more_key\x1b[201~");

		expect(pasteEvents).toEqual(["sk-ant-fake-key_more_key"]);
		expect(dataEvents).toEqual([]);
	});

	it("accumulates across chunks that split the START marker itself", () => {
		const buf = new StdinBuffer({ timeout: 50 });
		const pasteEvents: string[] = [];
		const dataEvents: string[] = [];
		buf.on("paste", (c) => pasteEvents.push(c));
		buf.on("data", (c) => dataEvents.push(c));

		// First chunk cuts off mid-START marker. Without buffering this
		// would surface as raw `\x1b[20` text and confuse downstream
		// matchesKey() callers.
		buf.process("\x1b[20");
		buf.process("0~sk-ant-key\x1b[201~");

		expect(pasteEvents).toEqual(["sk-ant-key"]);
		expect(dataEvents).toEqual([]);
	});

	it("accumulates across chunks that split the END marker itself", () => {
		const buf = new StdinBuffer({ timeout: 50 });
		const pasteEvents: string[] = [];
		const dataEvents: string[] = [];
		buf.on("paste", (c) => pasteEvents.push(c));
		buf.on("data", (c) => dataEvents.push(c));

		buf.process("\x1b[200~sk-ant-key\x1b");
		buf.process("[201~");

		expect(pasteEvents).toEqual(["sk-ant-key"]);
		expect(dataEvents).toEqual([]);
	});

	it("emits a paste for each back-to-back paste, in order", () => {
		const buf = new StdinBuffer({ timeout: 50 });
		const pasteEvents: string[] = [];
		const dataEvents: string[] = [];
		buf.on("paste", (c) => pasteEvents.push(c));
		buf.on("data", (c) => dataEvents.push(c));

		// Two pastes arrive in a single read.
		buf.process("\x1b[200~FIRST\x1b[201~\x1b[200~SECOND\x1b[201~");

		expect(pasteEvents).toEqual(["FIRST", "SECOND"]);
		expect(dataEvents).toEqual([]);
	});

	it("delivers text typed before a paste as 'data' events", () => {
		const buf = new StdinBuffer({ timeout: 50 });
		const pasteEvents: string[] = [];
		const dataEvents: string[] = [];
		buf.on("paste", (c) => pasteEvents.push(c));
		buf.on("data", (c) => dataEvents.push(c));

		// "a" typed, then paste of "bc", then "d" typed.
		buf.process("a\x1b[200~bc\x1b[201~d");

		expect(dataEvents).toEqual(["a", "d"]);
		expect(pasteEvents).toEqual(["bc"]);
	});
});