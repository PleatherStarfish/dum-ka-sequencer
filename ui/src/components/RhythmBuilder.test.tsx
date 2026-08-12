// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RhythmBuilder } from "./RhythmBuilder";

afterEach(cleanup);

const FIVE_GRID_TWO_BEATS = Array.from({ length: 2 }, () => ({
  spanLen: 5,
  subdivision: 5,
}));

describe("RhythmBuilder", () => {
  it("renders one block per element with kind and stroke in the name", () => {
    render(
      <RhythmBuilder pattern="dum . x ." disabled={false} onCommit={vi.fn()} />
    );
    expect(
      screen.getByRole("button", { name: "block 0: note dum" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "block 1: rest" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "block 3: rest" })).toBeTruthy();
  });

  it("turns a rest into a note through the toolbar", () => {
    const onCommit = vi.fn();
    render(
      <RhythmBuilder pattern="x . x ." disabled={false} onCommit={onCommit} />
    );
    fireEvent.click(screen.getByRole("button", { name: "block 1: rest" }));
    fireEvent.click(screen.getByRole("button", { name: "Set element to note" }));
    expect(onCommit).toHaveBeenCalledWith("x x x .");
  });

  it("splits a leaf into a tuplet with the chosen count", () => {
    const onCommit = vi.fn();
    render(
      <RhythmBuilder pattern="x . x ." disabled={false} onCommit={onCommit} />
    );
    fireEvent.click(screen.getByRole("button", { name: "block 0: note x" }));
    fireEvent.change(screen.getByLabelText("Split count"), {
      target: { value: "5" },
    });
    fireEvent.blur(screen.getByLabelText("Split count"));
    fireEvent.click(screen.getByRole("button", { name: "Split into tuplet" }));
    expect(onCommit).toHaveBeenCalledWith("[x x x x x] . x .");
  });

  it("groups a shift-selected run as an identity wrap", () => {
    const onCommit = vi.fn();
    render(
      <RhythmBuilder pattern="x . x ." disabled={false} onCommit={onCommit} />
    );
    fireEvent.click(screen.getByRole("button", { name: "block 0: note x" }));
    fireEvent.click(screen.getByRole("button", { name: "block 1: rest" }), {
      shiftKey: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Group selection" }));
    expect(onCommit).toHaveBeenCalledWith("[x .]@2 x .");
  });

  it("fills a leaf with a Euclidean rhythm from the toolbar", () => {
    const onCommit = vi.fn();
    render(
      <RhythmBuilder pattern="x . x ." disabled={false} onCommit={onCommit} />
    );
    fireEvent.click(screen.getByRole("button", { name: "block 0: note x" }));
    fireEvent.change(screen.getByLabelText("Euclid onsets"), {
      target: { value: "3" },
    });
    fireEvent.blur(screen.getByLabelText("Euclid onsets"));
    fireEvent.change(screen.getByLabelText("Euclid slots"), {
      target: { value: "8" },
    });
    fireEvent.blur(screen.getByLabelText("Euclid slots"));
    fireEvent.click(
      screen.getByRole("button", { name: "Fill with Euclidean rhythm" })
    );
    expect(onCommit).toHaveBeenCalledWith("[x . . x . . x .] . x .");
  });

  it("edits a group's count without changing its span", () => {
    const onCommit = vi.fn();
    render(
      <RhythmBuilder
        pattern="[x x x]@2 ."
        disabled={false}
        onCommit={onCommit}
      />
    );
    const handle = screen.getByRole("button", {
      name: "group 0: 3 in the time of 2",
    });
    expect(handle.textContent).toBe("3:2");
    fireEvent.click(handle);
    expect(
      (screen.getByRole("button", { name: "Ungroup" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);

    fireEvent.change(screen.getByLabelText("Group count"), {
      target: { value: "4" },
    });
    fireEvent.blur(screen.getByLabelText("Group count"));
    expect(onCommit).toHaveBeenCalledWith("[x x x x]@2 .");
  });

  it("spans existing top-level beats instead of adding beats", () => {
    const onCommit = vi.fn();
    const pattern =
      "[dum . . ka] [. . ka . x] [dum . ka .] [x x . x]";
    const view = render(
      <RhythmBuilder pattern={pattern} disabled={false} onCommit={onCommit} />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "group 5: 5 in the time of 1" })
    );
    expect(
      screen.getByText(
        "Span uses existing beats to the right. Growing replaces covered blocks; shrinking leaves rest."
      )
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Group span in existing beats"), {
      target: { value: "2" },
    });
    fireEvent.blur(screen.getByLabelText("Group span in existing beats"));
    const twoBeatPattern =
      "[dum . . ka] [. . ka . x]@2 [x x . x]";
    expect(onCommit).toHaveBeenLastCalledWith(twoBeatPattern);

    view.rerender(
      <RhythmBuilder
        pattern={twoBeatPattern}
        disabled={false}
        onCommit={onCommit}
      />
    );
    expect(view.container.querySelectorAll(".rb-ruler > span")).toHaveLength(4);
    fireEvent.change(screen.getByLabelText("Group span in existing beats"), {
      target: { value: "3" },
    });
    fireEvent.blur(screen.getByLabelText("Group span in existing beats"));
    expect(onCommit).toHaveBeenLastCalledWith(
      "[dum . . ka] [. . ka . x]@3"
    );
  });

  it("keeps a nested group's span parent-relative", () => {
    const onCommit = vi.fn();
    render(
      <RhythmBuilder pattern="[[x x] x]" disabled={false} onCommit={onCommit} />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "group 1: 2 in the time of 1" })
    );

    fireEvent.change(screen.getByLabelText("Group relative span"), {
      target: { value: "2" },
    });
    fireEvent.blur(screen.getByLabelText("Group relative span"));
    expect(onCommit).toHaveBeenCalledWith("[[x x]@2 x]");
  });

  it("builds and explicitly articulates a 5:2 group through the commit path", () => {
    const onCommit = vi.fn();
    const view = render(
      <RhythmBuilder pattern="x x" disabled={false} onCommit={onCommit} />
    );
    fireEvent.click(screen.getByRole("button", { name: "block 0: note x" }));
    fireEvent.click(screen.getByRole("button", { name: "block 1: note x" }), {
      shiftKey: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Group selection" }));
    expect(onCommit).toHaveBeenLastCalledWith("[x x]@2");

    view.rerender(
      <RhythmBuilder pattern="[x x]@2" disabled={false} onCommit={onCommit} />
    );
    fireEvent.change(screen.getByLabelText("Group count"), {
      target: { value: "5" },
    });
    fireEvent.blur(screen.getByLabelText("Group count"));
    expect(onCommit).toHaveBeenLastCalledWith("[x x x x x]@2");

    view.rerender(
      <RhythmBuilder
        pattern="[x x x x x]@2"
        disabled={false}
        projectionSpans={FIVE_GRID_TWO_BEATS}
        onCommit={onCommit}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Articulate" }));
    expect(onCommit).toHaveBeenLastCalledWith(
      "[[x .] [x .] [x .] [x .] [x .]]@2"
    );
  });

  it("offers Articulate for a nested spanning group", () => {
    const onCommit = vi.fn();
    render(
      <RhythmBuilder
        pattern="[[x x x x x]@2]@2"
        disabled={false}
        projectionSpans={FIVE_GRID_TWO_BEATS}
        onCommit={onCommit}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "group 1: 5 in the time of 2" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Articulate" }));
    expect(onCommit).toHaveBeenCalledWith(
      "[[[x .] [x .] [x .] [x .] [x .]]@2]@2"
    );
  });

  it("offers Articulate for the selected mixed 5:2 tuplet", () => {
    const onCommit = vi.fn();
    const pattern =
      "[dum . . ka] [. . ka . x]@2 [dum . ka .] [x x . x]";
    render(
      <RhythmBuilder
        pattern={pattern}
        disabled={false}
        projectionSpans={Array.from({ length: 5 }, () => ({
          spanLen: 20,
          subdivision: 20,
        }))}
        onCommit={onCommit}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "group 5: 5 in the time of 2" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Articulate" }));
    expect(onCommit).toHaveBeenCalledWith(
      "[dum . . ka] [. . [ka .] . [x .]]@2 [dum . ka .] [x x . x]"
    );
  });

  it("does not turn a preview error into a mandatory articulation repair", () => {
    render(
      <RhythmBuilder
        pattern="[x x x x x]@2"
        disabled={false}
        previewError="generator preview failed"
        projectionSpans={FIVE_GRID_TWO_BEATS}
        onCommit={vi.fn()}
      />
    );
    expect(
      screen.queryByRole("button", { name: "Articulate crossing notes" })
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "group 0: 5 in the time of 2" })
    );
    expect(screen.getByRole("button", { name: "Articulate" })).toBeTruthy();
  });

  it("rejects an illegal edit with the compiler's message and commits nothing", () => {
    const onCommit = vi.fn();
    render(<RhythmBuilder pattern="x ." disabled={false} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: "block 0: note x" }));
    fireEvent.click(screen.getByRole("button", { name: "Set element to hold" }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "'_' has nothing to extend; start with a note or rest"
    );
  });

  it("falls back to a hint when the pattern text does not parse", () => {
    render(<RhythmBuilder pattern="[x" disabled={false} onCommit={vi.fn()} />);
    expect(
      screen.getByText("Fix the pattern text below to edit it visually.")
    ).toBeTruthy();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("warns that visual edits expand sugar", () => {
    render(
      <RhythmBuilder pattern="E(3,8)@4" disabled={false} onCommit={vi.fn()} />
    );
    expect(
      screen.getByText(/rewrite E\(\.\.\.\), \*n repeats, comments/)
    ).toBeTruthy();
  });
});
