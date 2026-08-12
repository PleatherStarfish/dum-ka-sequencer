import { describe, expect, it } from "vitest";

import {
  VIRTUAL_ONLY_VALUE,
  buildDestinationOptions,
  destinationForValue,
  missingChipLabel,
  routeStatusLine,
  showMissingChip,
} from "./midiRouting";

const iac = { id: "-673416519", name: "IAC Driver Bus 1" };
const synth = { id: "12345", name: "Hardware Synth" };

describe("buildDestinationOptions", () => {
  it("always leads with virtual-only", () => {
    expect(buildDestinationOptions([], null)[0]).toEqual({
      value: VIRTUAL_ONLY_VALUE,
      label: "Virtual port only (default)",
      missing: false,
    });
  });

  it("lists present destinations by id with display names", () => {
    const options = buildDestinationOptions([iac, synth], iac);
    expect(options.map((option) => option.value)).toEqual([
      VIRTUAL_ONLY_VALUE,
      iac.id,
      synth.id,
    ]);
    expect(options.some((option) => option.missing)).toBe(false);
  });

  it("injects a missing entry when the desired destination is absent", () => {
    const options = buildDestinationOptions([synth], iac);
    expect(options.at(-1)).toEqual({
      value: iac.id,
      label: "IAC Driver Bus 1 (not found)",
      missing: true,
    });
  });
});

describe("destinationForValue", () => {
  it("maps virtual-only to null", () => {
    expect(destinationForValue(VIRTUAL_ONLY_VALUE, [iac], iac)).toBeNull();
  });

  it("prefers the live list, falls back to the desired spec", () => {
    expect(destinationForValue(iac.id, [iac], null)).toEqual(iac);
    expect(destinationForValue(iac.id, [], iac)).toEqual(iac);
    expect(destinationForValue("unknown", [], null)).toBeNull();
  });
});

describe("route status copy", () => {
  it("describes the three states", () => {
    expect(
      routeStatusLine({ desired: null, connected: false, lastError: null })
    ).toBe("Sending on the virtual port only.");
    expect(
      routeStatusLine({ desired: iac, connected: true, lastError: null })
    ).toBe("Also sending to IAC Driver Bus 1.");
    expect(
      routeStatusLine({
        desired: iac,
        connected: false,
        lastError: "destination not present",
      })
    ).toBe(
      "IAC Driver Bus 1 not found — virtual port only (destination not present)."
    );
  });

  it("chips only when a desired destination is unconnected", () => {
    expect(
      showMissingChip({ desired: null, connected: false, lastError: null })
    ).toBe(false);
    expect(
      showMissingChip({ desired: iac, connected: true, lastError: null })
    ).toBe(false);
    expect(
      showMissingChip({ desired: iac, connected: false, lastError: null })
    ).toBe(true);
    expect(
      missingChipLabel({ desired: iac, connected: false, lastError: null })
    ).toBe("MIDI out missing: IAC Driver Bus 1");
  });
});
