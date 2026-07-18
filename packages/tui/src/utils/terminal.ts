// Helpers for computing how many terminal columns a string occupies and for
// wrapping a line to fit a given column budget. CJK/fullwidth characters count
// as 2 columns, everything else as 1.

export interface WrappedRow {
  text: string;
  width: number;
}

function charDisplayWidth(ch: string): number {
  if (ch.length === 0) return 0;
  const code = ch.codePointAt(0) ?? 0;

  // East Asian Wide / Fullwidth ranges (approximation of wcwidth behavior).
  if (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    code === 0x2329 ||
    code === 0x232a ||
    (code >= 0x2e80 && code <= 0x303e) || // CJK Radicals, Symbols
    (code >= 0x3040 && code <= 0xa4cf) || // Hiragana, Katakana, CJK Unified
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility
    (code >= 0xfe10 && code <= 0xfe19) || // Vertical forms
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compatibility Forms
    (code >= 0xff00 && code <= 0xff60) || // Fullwidth ASCII variants
    (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth symbols
    (code >= 0x20000 && code <= 0x2fffd) || // CJK Extension B-D
    (code >= 0x30000 && code <= 0x3fffd) // CJK Extension E-I
  ) {
    return 2;
  }

  // Control characters and combining marks occupy zero columns.
  if (code < 0x20 || (code >= 0x300 && code <= 0x36f)) return 0;
  return 1;
}

export function displayWidth(input: string): number {
  let width = 0;
  for (const ch of input) {
    width += charDisplayWidth(ch);
  }
  return width;
}

export function wrapLineToRows(line: string, maxWidth: number): WrappedRow[] {
  if (maxWidth <= 0) {
    return [{ text: line, width: displayWidth(line) }];
  }

  const rows: WrappedRow[] = [];
  let current = "";
  let currentWidth = 0;

  for (const ch of line) {
    const w = charDisplayWidth(ch);
    if (currentWidth + w > maxWidth && current.length > 0) {
      rows.push({ text: current, width: currentWidth });
      current = ch;
      currentWidth = w;
    } else {
      current += ch;
      currentWidth += w;
    }
  }

  rows.push({ text: current, width: currentWidth });
  return rows;
}

/** Map a logical cursor position to the display row it falls on. */
export function findCursorDisplayRow(
  cursor: { line: number; col: number },
  lines: string[],
  maxWidth: number,
): number {
  let row = 0;
  for (let i = 0; i < cursor.line && i < lines.length; i++) {
    row += wrapLineToRows(lines[i]!, maxWidth).length;
  }

  const line = lines[cursor.line] ?? "";
  let width = 0;
  for (let c = 0; c < cursor.col && c < line.length; c++) {
    const w = displayWidth(line[c]!);
    if (width + w > maxWidth) {
      row++;
      width = 0;
    }
    width += w;
  }

  return row;
}
