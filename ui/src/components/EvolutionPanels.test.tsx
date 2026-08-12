// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DUMKA_OP_WEIGHTS } from "../dumkaPattern";
import { EvolutionPanels, type EvolutionPanelsProps } from "./EvolutionPanels";

afterEach(cleanup);

function props(overrides: Partial<EvolutionPanelsProps> = {}): EvolutionPanelsProps {
  return {
    pattern: "x . x .",
    structureLocked: false,
    enabled: true,
    evolutionRate: 9,
    setEvolutionRate: vi.fn(),
    driftLeash: 53,
    setDriftLeash: vi.fn(),
    barlowTemperature: 15,
    setBarlowTemperature: vi.fn(),
    fillComplexity: 0,
    setFillComplexity: vi.fn(),
    euclidMaxRun: 1,
    setEuclidMaxRun: vi.fn(),
    euclidInvert: 0,
    setEuclidInvert: vi.fn(),
    euclidRestPolicy: "tied" as const,
    setEuclidRestPolicy: vi.fn(),
    opWeights: { ...DEFAULT_DUMKA_OP_WEIGHTS },
    setOpWeights: vi.fn(),
    ...overrides,
  };
}

describe("EvolutionPanels", () => {
  it("quotes the engine's live numbers for rate, leash, and pools", () => {
    render(
      <EvolutionPanels
        {...props({ pattern: "x . x . | x . x@2 _ x", driftLeash: 53 })}
      />
    );
    // 5 onsets at 53% → div_ceil(53×5,100) = 3 slots.
    expect(
      screen.getByText(/⌈53% × 5 seed onsets⌉ = 3 slots of drift/)
    ).toBeTruthy();
    expect(
      screen.getByText(/about 1 cycle in 11/)
    ).toBeTruthy();
    // 10-beat grid at Subdivision 1: 5 sounding; the x@2 _ sustain covers
    // slots 6-8, leaving free slots 1, 3, 5.
    expect(
      screen.getByText(
        /Remove draws from the 1 weakest of 5 sounding pulses; Add from the 1 strongest of 3 free pulses./
      )
    ).toBeTruthy();
  });

  it("keeps every automation target and weight label stable", () => {
    render(<EvolutionPanels {...props()} />);
    for (const [name, target] of [
      ["Dum-Ka evolution rate", "generator.dumka.evolutionRate"],
      ["Dum-Ka drift leash", "generator.dumka.driftLeash"],
      ["Dum-Ka Barlow temperature", "generator.dumka.barlowTemperature"],
      ["Dum-Ka fill complexity", "generator.dumka.fillComplexity"],
    ] as const) {
      expect(
        screen
          .getByRole("slider", { name })
          .getAttribute("data-automation-target")
      ).toBe(target);
    }
    for (const name of [
      "Dum-Ka remove weight",
      "Dum-Ka add weight",
      "Dum-Ka rotate weight",
      "Dum-Ka syncopate weight",
      "Dum-Ka desyncopate weight",
      "Dum-Ka fragment weight",
      "Dum-Ka consolidate weight",
      "Dum-Ka euclid weight",
    ]) {
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
  });

  it("commits weights through the functional updater with odds shown", () => {
    const setOpWeights = vi.fn();
    render(<EvolutionPanels {...props({ setOpWeights })} />);
    // Defaults 3/3/2/0/0: remove odds 3/8.
    expect(screen.getAllByText("3/8 ≈ 38%").length).toBe(2);
    fireEvent.change(screen.getByLabelText("Dum-Ka syncopate weight"), {
      target: { value: "2" },
    });
    fireEvent.blur(screen.getByLabelText("Dum-Ka syncopate weight"));
    expect(setOpWeights).toHaveBeenCalled();
    const updater = setOpWeights.mock.calls.at(-1)![0] as (
      weights: typeof DEFAULT_DUMKA_OP_WEIGHTS
    ) => typeof DEFAULT_DUMKA_OP_WEIGHTS;
    expect(updater({ ...DEFAULT_DUMKA_OP_WEIGHTS })).toEqual({
      ...DEFAULT_DUMKA_OP_WEIGHTS,
      syncopate: 2,
    });
  });

  it("renders the rank lane with the temperature-widened pools outlined", () => {
    render(<EvolutionPanels {...props({ barlowTemperature: 100 })} />);
    const lane = screen.getByRole("img", {
      name: /Indispensability ranks for 4 pulses; Remove pool 2, Add pool 2/,
    });
    expect(lane.querySelectorAll(".is-remove-pool").length).toBe(2);
    expect(lane.querySelectorAll(".is-add-pool").length).toBe(2);
    expect(
      screen.getByRole("img", { name: /Metrical template for 4 pulses/ })
    ).toBeTruthy();
  });

  it("explains the seed-verbatim fallback beyond the published primes", () => {
    render(
      <EvolutionPanels {...props({ pattern: "[x x x x x x x x x x x]" })} />
    );
    expect(
      screen.getAllByText(/prime factor beyond 7/).length
    ).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("img", { name: /Indispensability/ })).toBeNull();
  });

  it("counts the seed's figure candidates in the figures card", () => {
    render(
      <EvolutionPanels {...props({ pattern: "[x _ _ _ _ _ . .] [ka . ka .]" })} />
    );
    // Subdivision 8, 16 slots: sustains x(0,6), ka(8,2), ka(12,2) plus the
    // three 2-slot silent runs are all fragmentable; every onset is
    // separated by silence, so nothing is consolidatable.
    expect(
      screen.getByText(
        "The seed has 6 fragmentable intervals (longest 6 slots) and 0 consolidatable runs."
      )
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Show figures reference" })
    );
    const reference = screen.getByRole("region", { name: "figures reference" });
    expect(reference.textContent).toContain("Mongeau");
    expect(reference.textContent).toContain("true equal tuplet");
  });

  it("carries the Caesura extension knobs on the reshape card", () => {
    render(<EvolutionPanels {...props({ euclidMaxRun: 3, euclidInvert: 20 })} />);
    expect(screen.getByLabelText("Dum-Ka euclid max run")).toBeTruthy();
    expect(screen.getByText("bursts ≤ 3")).toBeTruthy();
    expect(screen.getByText("20% of fires")).toBeTruthy();
    expect(
      (screen.getByLabelText("Dum-Ka euclid rest policy") as HTMLSelectElement)
        .value
    ).toBe("tied");
    expect(
      screen.getByText(/Windows: 4 beats plus the whole cycle/)
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Show Euclidean reshape reference" })
    );
    const reference = screen.getByRole("region", {
      name: "Euclidean reshape reference",
    });
    expect(reference.textContent).toContain("complement of a Euclidean rhythm");
    expect(reference.textContent).toContain("max run");
  });

  it("announces a frozen pattern when every weight is zero", () => {
    render(
      <EvolutionPanels
        {...props({
          opWeights: {
            barlowRemove: 0,
            barlowAdd: 0,
            rotate: 0,
            syncopate: 0,
            desyncopate: 0,
            fragment: 0,
            consolidate: 0,
            euclid: 0,
          },
        })}
      />
    );
    expect(
      screen.getByText(/All operator weights are zero, so even a fired cycle/)
    ).toBeTruthy();
  });

  it("discloses each algorithm's reference behind its help button", () => {
    render(<EvolutionPanels {...props()} />);
    expect(
      screen.queryByRole("region", { name: "Barlow density reference" })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show Barlow density reference" })
    );
    const reference = screen.getByRole("region", {
      name: "Barlow density reference",
    });
    expect(reference.textContent).toContain("pinned");
    expect(reference.textContent).toContain("field-strength");
    for (const label of [
      "evolution pipeline reference",
      "Sioros displacement reference",
      "rotation reference",
      "guards reference",
    ]) {
      expect(
        screen.getByRole("button", { name: `Show ${label}` })
      ).toBeTruthy();
    }
  });
});
