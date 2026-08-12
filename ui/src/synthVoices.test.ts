import { describe, expect, it } from "vitest";

import {
  GM_PERCUSSION_NOTES,
  GM_PROGRAM_NAMES,
  synthDrumLabel,
  synthProgramLabel,
  synthVoiceLabel,
} from "./synthVoices";

describe("synthProgramLabel", () => {
  it("is a 1-based number plus the GM name", () => {
    expect(synthProgramLabel(0)).toBe(`1. ${GM_PROGRAM_NAMES[0]}`);
    expect(synthProgramLabel(40)).toBe(`41. ${GM_PROGRAM_NAMES[40]}`);
  });

  it("clamps and rounds out-of-range programs", () => {
    expect(synthProgramLabel(200)).toBe(`128. ${GM_PROGRAM_NAMES[127]}`);
    expect(synthProgramLabel(-5)).toBe(`1. ${GM_PROGRAM_NAMES[0]}`);
  });
});

describe("synthDrumLabel", () => {
  it("names known percussion notes", () => {
    const named = GM_PERCUSSION_NOTES.find((n) => n.note === 36)?.name;
    expect(synthDrumLabel(36)).toBe(`36. ${named}`);
  });

  it("falls back for unnamed keys", () => {
    expect(synthDrumLabel(127)).toMatch(/^127\. /);
  });
});

describe("synthVoiceLabel", () => {
  it("describes percussion vs melodic voices", () => {
    expect(
      synthVoiceLabel({ channel: 1, mode: "percussion", program: 0, drumNote: 36 })
    ).toBe(`percussion · ${synthDrumLabel(36)}`);
    expect(
      synthVoiceLabel({ channel: 1, mode: "melodic", program: 4, drumNote: 36 })
    ).toBe(`melodic · ${synthProgramLabel(4)}`);
  });
});
