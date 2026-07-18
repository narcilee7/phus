// test/tui/DiffReview.test.tsx
// Diff review card rendering and accept/reject/edit action tests.

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { DiffReview } from "../src/components/diff-components/DiffReview.js";
import {
  DiffReviewContext,
  type DiffReviewAction,
} from "../src/components/diff-components/DiffReviewContext.js";
import { TuiFocusContext } from "../src/context/tui-focus-context.js";

const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function renderWithAction(
  ui: React.ReactElement,
  opts: { focusedId?: string | null; onAction?: (a: DiffReviewAction) => void } = {},
) {
  const focusedId = opts.focusedId ?? null;
  return render(
    <TuiFocusContext.Provider
      value={{
        focusedId,
        focusedKind: focusedId ? "diffreview" : null,
        setFocused: vi.fn(),
      }}
    >
      <DiffReviewContext.Provider
        value={{
          onAction: opts.onAction ?? vi.fn(),
        }}
      >
        {ui}
      </DiffReviewContext.Provider>
    </TuiFocusContext.Provider>,
  );
}

describe("DiffReview", () => {
  it("renders path, diff and action hints", async () => {
    const { lastFrame } = renderWithAction(
      <DiffReview path="src/foo.ts" oldContent="old" newContent="new" id="dr1" />,
    );
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("src/foo.ts");
    expect(frame).toContain("accept(a)");
    expect(frame).toContain("reject(r)");
    expect(frame).toContain("edit(e)");
    expect(frame).toContain("- old");
    expect(frame).toContain("+ new");
  });

  it("triggers accept action when focused and a is pressed", async () => {
    const onAction = vi.fn();
    const { stdin } = renderWithAction(
      <DiffReview path="src/foo.ts" oldContent="old" newContent="new" id="dr1" />,
      { focusedId: "dr1", onAction },
    );
    await wait();
    stdin.write("a");
    await wait();
    expect(onAction).toHaveBeenCalledWith({ type: "accept", path: "src/foo.ts" });
  });

  it("triggers reject action when focused and r is pressed", async () => {
    const onAction = vi.fn();
    const { stdin } = renderWithAction(
      <DiffReview path="src/foo.ts" oldContent="old" newContent="new" id="dr1" />,
      { focusedId: "dr1", onAction },
    );
    await wait();
    stdin.write("r");
    await wait();
    expect(onAction).toHaveBeenCalledWith({
      type: "reject",
      path: "src/foo.ts",
      oldContent: "old",
    });
  });

  it("triggers edit action when focused and e is pressed", async () => {
    const onAction = vi.fn();
    const { stdin } = renderWithAction(
      <DiffReview path="src/foo.ts" oldContent="old" newContent="new" id="dr1" />,
      { focusedId: "dr1", onAction },
    );
    await wait();
    stdin.write("e");
    await wait();
    expect(onAction).toHaveBeenCalledWith({
      type: "edit",
      path: "src/foo.ts",
      newContent: "new",
    });
  });

  it("ignores action keys when not focused", async () => {
    const onAction = vi.fn();
    const { stdin } = renderWithAction(
      <DiffReview path="src/foo.ts" oldContent="old" newContent="new" id="dr1" />,
      { focusedId: null, onAction },
    );
    await wait();
    stdin.write("a");
    await wait();
    stdin.write("r");
    await wait();
    stdin.write("e");
    await wait();
    expect(onAction).not.toHaveBeenCalled();
  });
});
