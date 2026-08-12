// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  TRANSPORT_WARNING_ID,
  TRANSPORT_WARNING_LABEL,
  TransportWarning,
} from "./TransportWarning";

afterEach(cleanup);

const MESSAGE =
  "dumka structure mismatch: pattern spans 4 beats but the cycle has 8";

describe("TransportWarning", () => {
  it("renders no status for a transient or recovered state", () => {
    const { rerender } = render(<TransportWarning message={null} />);
    expect(screen.queryByRole("status")).toBeNull();

    rerender(<TransportWarning message={MESSAGE} />);
    expect(screen.getByRole("status")).toBeTruthy();

    rerender(<TransportWarning message={null} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders the existing compact warning markup with the full error", () => {
    render(<TransportWarning message={MESSAGE} />);

    const status = screen.getByRole("status");
    expect(status.id).toBe(TRANSPORT_WARNING_ID);
    expect(status.classList.contains("transport-warning")).toBe(true);
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.getAttribute("title")).toBe(
      `${TRANSPORT_WARNING_LABEL}: ${MESSAGE}`
    );
    expect(status.textContent).toContain(TRANSPORT_WARNING_LABEL);
    expect(status.textContent).toContain(MESSAGE);

    const icon = status.querySelector(".transport-warning-icon");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.textContent?.trim()).toBe("!");
    expect(status.querySelector(".transport-warning-copy")?.textContent).toContain(
      MESSAGE
    );
  });

  it("updates the visible and hover text when the current rejection changes", () => {
    const { rerender } = render(<TransportWarning message={MESSAGE} />);
    const nextMessage = "generator preview rejected cycle 4";

    rerender(<TransportWarning message={nextMessage} />);

    const status = screen.getByRole("status");
    expect(status.textContent).not.toContain(MESSAGE);
    expect(status.textContent).toContain(nextMessage);
    expect(status.getAttribute("title")).toBe(
      `${TRANSPORT_WARNING_LABEL}: ${nextMessage}`
    );
  });
});
