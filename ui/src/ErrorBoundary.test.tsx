// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ErrorBoundary } from "./ErrorBoundary";

function Bomb(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>ok</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("ok")).toBeTruthy();
  });

  it("shows the fallback with the error message when a child throws", () => {
    // React logs the caught error; silence it so the suite output stays clean.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
      );
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText("boom")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });
});
