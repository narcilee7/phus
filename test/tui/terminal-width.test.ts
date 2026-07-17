// test/tui/terminal-width.test.ts

import { describe, expect, it } from "vitest";
import {
  displayWidth,
  findCursorDisplayRow,
  wrapLineToRows,
} from "../../src/tui/components/terminal-width.js";

describe("displayWidth", () => {
  it("counts ASCII characters as one column", () => {
    expect(displayWidth("hello")).toBe(5);
  });

  it("counts CJK characters as two columns", () => {
    expect(displayWidth("中文")).toBe(4);
  });

  it("mixes ASCII and CJK widths", () => {
    expect(displayWidth("a中b文")).toBe(6);
  });
});

describe("wrapLineToRows", () => {
  it("does not split lines that fit", () => {
    expect(wrapLineToRows("hello", 10)).toEqual([{ text: "hello", width: 5 }]);
  });

  it("wraps CJK text at display-width boundaries", () => {
    const rows = wrapLineToRows("中文测试", 4);
    expect(rows).toEqual([
      { text: "中文", width: 4 },
      { text: "测试", width: 4 },
    ]);
  });

  it("wraps mixed text correctly", () => {
    const rows = wrapLineToRows("a中文b", 4);
    expect(rows).toEqual([
      { text: "a中", width: 3 },
      { text: "文b", width: 3 },
    ]);
  });
});

describe("findCursorDisplayRow", () => {
  it("places the cursor on the first display row by default", () => {
    expect(findCursorDisplayRow({ line: 0, col: 0 }, ["hello"], 10)).toBe(0);
  });

  it("moves to the next display row when CJK wraps", () => {
    // "中文测试" at width 4 wraps into two rows.
    // Cursor after "测" (col 3) is on the second display row.
    expect(findCursorDisplayRow({ line: 0, col: 3 }, ["中文测试"], 4)).toBe(1);
  });

  it("counts display rows across multiple logical lines", () => {
    const lines = ["中文测试", "ok"];
    // First logical line wraps to 2 display rows; cursor in second logical line.
    expect(findCursorDisplayRow({ line: 1, col: 0 }, lines, 4)).toBe(2);
  });
});
