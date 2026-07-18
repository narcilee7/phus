// test/tui/ErrorBoundary.test.tsx
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ErrorBoundary } from "../src/components/app-common-components/ErrorBoundary.js";

function Boom(): React.ReactElement {
  throw new Error("kaboom");
}

describe("ErrorBoundary", () => {
  it("renders the children when there is no error", () => {
    const { lastFrame } = render(
      <ErrorBoundary>
        <span>hello</span>
      </ErrorBoundary>,
    );
    expect(lastFrame()).toContain("hello");
  });

  it("renders an error panel when a child throws", () => {
    // Suppress React's noisy error logging during this test.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { lastFrame } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(lastFrame()).toContain("TUI crashed");
    expect(lastFrame()).toContain("kaboom");
    spy.mockRestore();
  });

  it("calls onRecover when the user presses Enter on the panel", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onRecover = vi.fn();
    const { stdin } = render(
      <ErrorBoundary onRecover={onRecover}>
        <Boom />
      </ErrorBoundary>,
    );
    stdin.write("\r");
    expect(onRecover).toHaveBeenCalled();
    spy.mockRestore();
  });
});
