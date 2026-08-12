import { describe, expect, it } from "vitest";

import {
  defaultPatchFilename,
  defaultScoreFilename,
  defaultTrackFilename,
  fileNameFromPath,
  slugifyName,
} from "./filenames";

describe("slugifyName", () => {
  it("lowercases and hyphenates non-filename characters", () => {
    expect(slugifyName("My Cool Patch!", "x")).toBe("my-cool-patch");
    expect(slugifyName("A / B \\ C", "x")).toBe("a-b-c");
  });

  it("collapses runs and trims leading/trailing hyphens", () => {
    expect(slugifyName("  ***hello***  ", "x")).toBe("hello");
    expect(slugifyName("a___b", "x")).toBe("a___b"); // underscores are allowed
    expect(slugifyName("a   b", "x")).toBe("a-b");
  });

  it("preserves allowed dot/underscore/hyphen", () => {
    expect(slugifyName("v1.2_final-mix", "x")).toBe("v1.2_final-mix");
  });

  it("falls back when the result is empty", () => {
    expect(slugifyName("", "fallback")).toBe("fallback");
    expect(slugifyName("!!!", "fallback")).toBe("fallback");
    expect(slugifyName("   ", "fallback")).toBe("fallback");
  });
});

describe("default filenames carry the right extension", () => {
  it("patch → .dumka, fallback untitled", () => {
    expect(defaultPatchFilename("Song A")).toBe("song-a.dumka");
    expect(defaultPatchFilename("")).toBe("untitled.dumka");
  });

  it("score → .dumka-cycle.json, fallback untitled", () => {
    expect(defaultScoreFilename("Song A")).toBe("song-a.dumka-cycle.json");
    expect(defaultScoreFilename("")).toBe("untitled.dumka-cycle.json");
  });

  it("track → .dumka-track, fallback track", () => {
    expect(defaultTrackFilename("Lead Synth")).toBe("lead-synth.dumka-track");
    expect(defaultTrackFilename("")).toBe("track.dumka-track");
  });
});

describe("fileNameFromPath", () => {
  it("returns the last segment for unix and windows paths", () => {
    expect(fileNameFromPath("/a/b/song.dumka")).toBe("song.dumka");
    expect(fileNameFromPath("C:\\proj\\song.dumka")).toBe("song.dumka");
    expect(fileNameFromPath("song.dumka")).toBe("song.dumka");
  });

  it("ignores trailing separators", () => {
    expect(fileNameFromPath("/a/b/")).toBe("b");
  });

  it("falls back to the input when there is no segment", () => {
    expect(fileNameFromPath("")).toBe("");
    expect(fileNameFromPath("/")).toBe("/");
  });
});
