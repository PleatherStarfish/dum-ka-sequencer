// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { flushEditorDrafts } from "../editorDraftFlush";
import { GeneratorEditor, type GeneratorEditorProps } from "./GeneratorEditor";
import { rollEuclideanSeed } from "../dumkaSeedRoll";

afterEach(cleanup);

function props(overrides: Partial<GeneratorEditorProps> = {}): GeneratorEditorProps {
  return {
    open: true,
    enabled: true,
    kind: "example",
    densityPercent: 60,
    dumkaPattern: "x . x .",
    dumkaEvolutionRate: 0,
    dumkaDriftLeash: 25,
    dumkaDensityFloor: 0,
    dumkaDensityCeiling: 100,
    dumkaPreviewError: null,
    dumkaRequired: { cycleBeats: 4, subdivision: 1, workingSubdivision: 1 },
    dumkaStructureReady: false,
    dumkaAuthoredSubdivision: null,
    dumkaProjectionSpans: Array.from({ length: 4 }, () => ({
      spanLen: 1,
      subdivision: 1,
    })),
    seedMode: "locked",
    seed: 42,
    playbackStructureLocked: false,
    setOpen: vi.fn(),
    setEnabled: vi.fn(),
    setKind: vi.fn(),
    setDensityPercent: vi.fn(),
    onDumkaPatternCommit: vi.fn(),
    onApplyDumkaStructure: vi.fn(),
    setDumkaEvolutionRate: vi.fn(),
    setDumkaDriftLeash: vi.fn(),
    setDumkaDensityFloor: vi.fn(),
    setDumkaDensityCeiling: vi.fn(),
    dumkaBarlowTemperature: 0,
    setDumkaBarlowTemperature: vi.fn(),
    dumkaFillComplexity: 0,
    setDumkaFillComplexity: vi.fn(),
    dumkaEuclidMaxRun: 1,
    setDumkaEuclidMaxRun: vi.fn(),
    dumkaEuclidInvert: 0,
    setDumkaEuclidInvert: vi.fn(),
    dumkaEuclidRestPolicy: "tied" as const,
    setDumkaEuclidRestPolicy: vi.fn(),
    dumkaOpWeights: {
      barlowRemove: 3,
      barlowAdd: 3,
      rotate: 2,
      syncopate: 0,
      desyncopate: 0,
      fragment: 0,
      consolidate: 0,
      euclid: 0,
    },
    setDumkaOpWeights: vi.fn(),
    setSeedMode: vi.fn(),
    setSeed: vi.fn(),
    ...overrides,
  };
}

describe("GeneratorEditor", () => {
  it("does not mount controls while closed", () => {
    render(<GeneratorEditor {...props({ open: false })} />);
    expect(screen.queryByLabelText("Generator density")).toBeNull();
  });

  it("authors enable, density, seed mode, and seed", () => {
    const setEnabled = vi.fn();
    const setDensityPercent = vi.fn();
    const setSeedMode = vi.fn();
    const setSeed = vi.fn();
    render(
      <GeneratorEditor
        {...props({ setEnabled, setDensityPercent, setSeedMode, setSeed })}
      />
    );

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.keyDown(
      screen.getByRole("slider", { name: "Generator density" }),
      { key: "ArrowRight" }
    );
    fireEvent.change(screen.getByLabelText("Generator seed mode"), {
      target: { value: "perCycle" },
    });
    fireEvent.change(screen.getByLabelText("Generator seed"), {
      target: { value: "99" },
    });
    fireEvent.blur(screen.getByLabelText("Generator seed"));

    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(setDensityPercent).toHaveBeenCalledWith(61);
    expect(setSeedMode).toHaveBeenCalledWith("perCycle");
    expect(setSeed).toHaveBeenCalledWith(99);
  });

  it("explains a compatible oversized Subdivision and offers the simplify rewrite", () => {
    const onApplyDumkaStructure = vi.fn();
    render(
      <GeneratorEditor
        {...props({
          kind: "dumka",
          dumkaRequired: { cycleBeats: 4, subdivision: 5, workingSubdivision: 5 },
          dumkaStructureReady: true,
          dumkaAuthoredSubdivision: 35,
          onApplyDumkaStructure,
        })}
      />
    );
    expect(screen.getByLabelText("Required structure").textContent).toBe(
      "needs 4 beats · Subdivision 5 · authored 35 = 7 × 5 (compatible; cells show 7× matra counts)"
    );
    const simplify = screen.getByRole("button", { name: "Simplify to 5" });
    fireEvent.click(simplify);
    expect(onApplyDumkaStructure).toHaveBeenCalledTimes(1);

    cleanup();
    render(
      <GeneratorEditor
        {...props({
          kind: "dumka",
          dumkaRequired: { cycleBeats: 4, subdivision: 5, workingSubdivision: 5 },
          dumkaStructureReady: true,
          dumkaAuthoredSubdivision: 5,
        })}
      />
    );
    expect(screen.getByLabelText("Required structure").textContent).toBe(
      "needs 4 beats · Subdivision 5"
    );
    const ready = screen.getByRole("button", { name: "Structure ready" });
    expect((ready as HTMLButtonElement).disabled).toBe(true);
  });

  it("rolls a Euclidean seed through the ordinary commit path", () => {
    const onDumkaPatternCommit = vi.fn();
    const pattern = "[x x x x x] [x . x .] x x";
    render(
      <GeneratorEditor
        {...props({
          kind: "dumka",
          dumkaPattern: pattern,
          dumkaRequired: { cycleBeats: 4, subdivision: 20, workingSubdivision: 20 },
          onDumkaPatternCommit,
        })}
      />
    );
    fireEvent.change(screen.getByLabelText("Seed roll number"), {
      target: { value: "9" },
    });
    fireEvent.blur(screen.getByLabelText("Seed roll number"));
    fireEvent.click(screen.getByRole("button", { name: "Roll Euclidean seed" }));
    expect(onDumkaPatternCommit).toHaveBeenCalledWith(
      rollEuclideanSeed(9, {
        slotsPerBeat: [5, 4, 1, 1],
        density: "medium",
        style: "plain",
        restPolicy: "tied",
      })
    );
    // Plain rolls are readable sugar, and each physical beat keeps the
    // compiler-visible grid that contributed to the global LCM.
    const rolled = onDumkaPatternCommit.mock.calls[0]![0] as string;
    expect(rolled.startsWith("E(")).toBe(true);
    expect(rolled.split(" ")).toHaveLength(4);
    expect(rolled).toMatch(/^E\(\d+,5(?:,\d+)?\) E\(\d+,4(?:,\d+)?\) E\(1,1\) E\(1,1\)$/);
  });

  it("authors a compact Depth palette, corridor, and placement bias", () => {
    const setPalette = vi.fn();
    const setFloor = vi.fn();
    const setCeiling = vi.fn();
    const setBias = vi.fn();
    render(
      <GeneratorEditor
        {...props({
          kind: "dumka",
          dumkaSubdivisionPalette: [3],
          dumkaRequired: {
            cycleBeats: 4,
            subdivision: 4,
            workingSubdivision: 12,
          },
          dumkaComplexityFloor: 12_000,
          dumkaComplexityCeiling: 60_000,
          dumkaPlacementBias: 25,
          dumkaStateDepthDiversityMilli: 62_500,
          setDumkaSubdivisionPalette: setPalette,
          setDumkaComplexityFloor: setFloor,
          setDumkaComplexityCeiling: setCeiling,
          setDumkaPlacementBias: setBias,
        })}
      />
    );
    expect(screen.getByLabelText("Required structure").textContent).toContain(
      "working 12 (palette ×3)"
    );
    expect(screen.getByText("Working Subdivision 12")).toBeTruthy();
    expect(screen.getByLabelText("Depth diversity 62.5")).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "Placement blend: 75% metric, 25% geometric void seeking",
      })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Subdivision level 2" }));
    expect(setPalette).toHaveBeenCalledWith([2, 3]);
    fireEvent.change(screen.getByLabelText("Complexity floor"), {
      target: { value: "20.5" },
    });
    fireEvent.blur(screen.getByLabelText("Complexity floor"));
    expect(setFloor).toHaveBeenCalledWith(20_500);
    fireEvent.change(screen.getByLabelText("Complexity ceiling"), {
      target: { value: "44.2" },
    });
    fireEvent.blur(screen.getByLabelText("Complexity ceiling"));
    expect(setCeiling).toHaveBeenCalledWith(44_200);
    fireEvent.keyDown(
      screen.getByRole("slider", { name: "Geometric placement bias" }),
      { key: "ArrowRight" }
    );
    expect(setBias).toHaveBeenCalledWith(26);
  });

  it("does not roll an arbitrary grid when the committed pattern is invalid", () => {
    const onDumkaPatternCommit = vi.fn();
    render(
      <GeneratorEditor
        {...props({
          kind: "dumka",
          dumkaPattern: "[x",
          dumkaRequired: null,
          onDumkaPatternCommit,
        })}
      />
    );

    const roll = screen.getByRole("button", { name: "Roll Euclidean seed" });
    expect(roll).toHaveProperty("disabled", true);
    fireEvent.click(roll);
    expect(onDumkaPatternCommit).not.toHaveBeenCalled();
  });

  it("discloses the pattern syntax reference behind the help button", () => {
    render(<GeneratorEditor {...props({ kind: "dumka" })} />);
    expect(
      screen.queryByRole("region", { name: "Pattern syntax reference" })
    ).toBeNull();

    const toggle = screen.getByRole("button", {
      name: "Show pattern syntax reference",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);

    const reference = screen.getByRole("region", {
      name: "Pattern syntax reference",
    });
    expect(reference.textContent).toContain("five in the time of two");
    expect(reference.textContent).toContain("E(3,8) is the tresillo");
    const hide = screen.getByRole("button", {
      name: "Hide pattern syntax reference",
    });
    expect(hide.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(hide);
    expect(
      screen.queryByRole("region", { name: "Pattern syntax reference" })
    ).toBeNull();
  });

  it("switches kinds and keeps kind-specific controls exclusive", () => {
    const setKind = vi.fn();
    const { rerender } = render(<GeneratorEditor {...props({ setKind })} />);
    expect(screen.queryByLabelText("Dum-Ka pattern")).toBeNull();

    fireEvent.change(screen.getByLabelText("Generator kind"), {
      target: { value: "dumka" },
    });
    expect(setKind).toHaveBeenCalledWith("dumka");

    rerender(<GeneratorEditor {...props({ kind: "dumka" })} />);
    expect(screen.getByLabelText("Dum-Ka pattern")).toBeTruthy();
    expect(screen.queryByRole("slider", { name: "Generator density" })).toBeNull();
  });

  it("commits the pattern on blur, not per keystroke", () => {
    const onDumkaPatternCommit = vi.fn();
    render(
      <GeneratorEditor {...props({ kind: "dumka", onDumkaPatternCommit })} />
    );
    const field = screen.getByLabelText("Dum-Ka pattern");
    fireEvent.change(field, { target: { value: "dum . ka ." } });
    expect(onDumkaPatternCommit).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(onDumkaPatternCommit).toHaveBeenCalledWith("dum . ka .");
  });

  it("flushes an in-progress pattern draft through the shared lifecycle", async () => {
    const onDumkaPatternCommit = vi.fn();
    render(
      <GeneratorEditor {...props({ kind: "dumka", onDumkaPatternCommit })} />
    );
    fireEvent.change(screen.getByLabelText("Dum-Ka pattern"), {
      target: { value: "x x . x" },
    });
    await flushEditorDrafts();
    expect(onDumkaPatternCommit).toHaveBeenCalledWith("x x . x");
  });

  it("shows local diagnostics with position while typing", () => {
    render(<GeneratorEditor {...props({ kind: "dumka" })} />);
    fireEvent.change(screen.getByLabelText("Dum-Ka pattern"), {
      target: { value: "x .\n[x ka@0]" },
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "line 2, column 7: weight must be 1-512"
    );
  });

  it("surfaces the backend preview error for the committed pattern", () => {
    render(
      <GeneratorEditor
        {...props({
          kind: "dumka",
          dumkaPreviewError:
            "dumka structure mismatch: pattern needs Subdivision 5 (or a multiple); the section has 4",
        })}
      />
    );
    expect(
      screen.getByText(/pattern needs Subdivision 5/).textContent
    ).toContain("dumka structure mismatch");
  });

  it("forwards current Grouping fences to the optional Articulate gesture", () => {
    const onDumkaPatternCommit = vi.fn();
    render(
      <GeneratorEditor
        {...props({
          kind: "dumka",
          dumkaPattern: "[[x x x x x]@2 .]@2",
          dumkaRequired: { cycleBeats: 2, subdivision: 15, workingSubdivision: 15 },
          dumkaStructureReady: true,
          dumkaProjectionSpans: Array.from({ length: 10 }, () => ({
            spanLen: 3,
            subdivision: 15,
          })),
          onDumkaPatternCommit,
        })}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "group 1: 5 in the time of 2" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Articulate" }));
    expect(onDumkaPatternCommit).toHaveBeenCalledWith(
      "[[[x .@3] [x .@3] [x .@3] [x .@3] [x .@3]]@2 .]@2"
    );
  });

  it("authors the temperature and operator weights", () => {
    const setDumkaBarlowTemperature = vi.fn();
    const setDumkaOpWeights = vi.fn();
    render(
      <GeneratorEditor
        {...props({ kind: "dumka", setDumkaBarlowTemperature, setDumkaOpWeights })}
      />
    );
    fireEvent.keyDown(
      screen.getByRole("slider", { name: "Dum-Ka Barlow temperature" }),
      { key: "ArrowRight" }
    );
    expect(setDumkaBarlowTemperature).toHaveBeenCalledWith(1);

    fireEvent.change(screen.getByLabelText("Dum-Ka syncopate weight"), {
      target: { value: "4" },
    });
    fireEvent.blur(screen.getByLabelText("Dum-Ka syncopate weight"));
    expect(setDumkaOpWeights).toHaveBeenCalledTimes(1);
    const updater = setDumkaOpWeights.mock.calls[0]![0] as (
      weights: Record<string, number>
    ) => Record<string, number>;
    expect(
      updater({ barlowRemove: 3, barlowAdd: 3, rotate: 2, syncopate: 0, desyncopate: 0 })
    ).toEqual({ barlowRemove: 3, barlowAdd: 3, rotate: 2, syncopate: 4, desyncopate: 0 });
  });

  it("applies the required structure and disables the button once ready", () => {
    const onApplyDumkaStructure = vi.fn();
    const { rerender } = render(
      <GeneratorEditor
        {...props({
          kind: "dumka",
          dumkaRequired: { cycleBeats: 4, subdivision: 20, workingSubdivision: 20 },
          onApplyDumkaStructure,
        })}
      />
    );
    expect(screen.getByLabelText("Required structure").textContent).toBe(
      "needs 4 beats · Subdivision 20"
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply structure" }));
    expect(onApplyDumkaStructure).toHaveBeenCalledTimes(1);

    rerender(
      <GeneratorEditor
        {...props({
          kind: "dumka",
          dumkaRequired: { cycleBeats: 4, subdivision: 20, workingSubdivision: 20 },
          dumkaStructureReady: true,
        })}
      />
    );
    const ready = screen.getByRole("button", { name: "Structure ready" });
    expect(ready).toHaveProperty("disabled", true);
  });
});
