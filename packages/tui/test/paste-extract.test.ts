// test/extract-paste-content.test.ts
// Unit tests for the bracketed-paste detector shared by the wizard
// text-input steps. Issue #1 — pasting an API key into the bootstrap
// wizard was being silently dropped because `data.startsWith("\x1b")`
// matches the entire `ESC[200~…ESC[201~` payload.

import { describe, expect, it } from "vitest";
import { extractPasteContent } from "../src/runtime/text-utils.js";

describe("extractPasteContent", () => {
	it("returns the inner content of a complete bracketed paste payload", () => {
		const payload = "\x1b[200~sk-ant-fake-key\x1b[201~";
		expect(extractPasteContent(payload)).toBe("sk-ant-fake-key");
	});

	it("returns empty string for an empty paste payload", () => {
		expect(extractPasteContent("\x1b[200~\x1b[201~")).toBe("");
	});

	it("returns null for plain typed input", () => {
		expect(extractPasteContent("a")).toBeNull();
		expect(extractPasteContent("sk-ant-typed-char")).toBeNull();
	});

	it("returns null for escape sequences that are not bracketed paste", () => {
		expect(extractPasteContent("\x1b[A")).toBeNull(); // arrow up
		expect(extractPasteContent("\x1b[3~")).toBeNull(); // delete key
		expect(extractPasteContent("\x1b")).toBeNull();
	});

	it("returns null when only one marker is present", () => {
		expect(extractPasteContent("\x1b[200~sk-ant-no-end")).toBeNull();
		expect(extractPasteContent("sk-ant-no-start\x1b[201~")).toBeNull();
	});

	it("returns null for an empty input", () => {
		expect(extractPasteContent("")).toBeNull();
	});

	it("preserves newlines and spaces inside the pasted payload", () => {
		const payload = "\x1b[200~line 1\nline 2\x1b[201~";
		expect(extractPasteContent(payload)).toBe("line 1\nline 2");
	});
});
