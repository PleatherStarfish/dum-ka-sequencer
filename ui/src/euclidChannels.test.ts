import { describe, expect, it } from "vitest";

import {
  bjorklundBurstMask,
  bjorklundMask,
  canonicalEuclidLayersForChannels,
  euclidLayerMask,
  euclidPartitionTable,
  euclidStackPeriod,
  euclidStackTable,
  intervalVector,
  isEuclideanString,
  isReverseEuclideanString,
  rotateMaskLater,
  seedEuclidLayersFromChannels,
} from "./euclidChannels";

const toString = (mask: boolean[]) => mask.map((bit) => (bit ? "1" : "0")).join("");

const layer = (
  channel: number,
  pulses: number,
  overrides: Partial<Parameters<typeof euclidLayerMask>[0]> = {}
) => ({
  channel,
  pulses,
  rotation: 0,
  maxRun: 1,
  steps: 16,
  invert: false,
  ...overrides,
});

describe("bjorklundMask", () => {
  it("matches the literature golden vectors (same goldens as cseq-rhythm)", () => {
    expect(toString(bjorklundMask(3, 7))).toBe("1010100");
    expect(toString(bjorklundMask(4, 9))).toBe("101010100");
    expect(toString(bjorklundMask(5, 9))).toBe("101010101");
    expect(toString(bjorklundMask(4, 11))).toBe("10010010010");
    expect(toString(bjorklundMask(6, 12))).toBe("101010101010");
    expect(toString(bjorklundMask(7, 12))).toBe("101101011010");
    expect(toString(bjorklundMask(5, 13))).toBe("1001010010100");
    expect(toString(bjorklundMask(5, 16))).toBe("1001001001001000");
    expect(toString(bjorklundMask(4, 16))).toBe("1000100010001000");
    expect(toString(bjorklundMask(0, 4))).toBe("0000");
    expect(toString(bjorklundMask(4, 4))).toBe("1111");
    expect(toString(bjorklundMask(9, 4))).toBe("1111");
    expect(bjorklundMask(3, 0)).toEqual([]);
  });
});

describe("bjorklundBurstMask", () => {
  it("matches the moinsound worked example and reduces at run one", () => {
    expect(toString(bjorklundBurstMask(5, 13, 3))).toBe("1110000110000");
    expect(toString(bjorklundBurstMask(2, 8, 5))).toBe("11000000");
    for (let n = 1; n <= 24; n += 1) {
      for (let k = 0; k <= n; k += 1) {
        expect(bjorklundBurstMask(k, n, 1)).toEqual(bjorklundMask(k, n));
      }
    }
  });

  it("preserves the onset count", () => {
    for (let n = 1; n <= 20; n += 1) {
      for (let k = 0; k <= n; k += 1) {
        for (let run = 1; run <= 5; run += 1) {
          const mask = bjorklundBurstMask(k, n, run);
          expect(mask).toHaveLength(n);
          expect(mask.filter(Boolean)).toHaveLength(k);
        }
      }
    }
  });
});

describe("rotateMaskLater", () => {
  it("shifts the mask later and survives negative or oversized rotations", () => {
    expect(toString(rotateMaskLater(bjorklundMask(3, 8), 1))).toBe("01001001");
    expect(toString(rotateMaskLater(bjorklundMask(3, 8), 9))).toBe("01001001");
    expect(toString(rotateMaskLater(bjorklundMask(3, 8), -1))).toBe("00100101");
    expect(rotateMaskLater([], 3)).toEqual([]);
  });
});

describe("euclidPartitionTable", () => {
  it("gives exact quotas with the top layer on absolute Bjorklund slots", () => {
    const table = euclidPartitionTable(8, [layer(2, 3), layer(3, 2)], 1);
    const top = bjorklundMask(3, 8);
    table.forEach((slot, index) => {
      expect(slot.channel === 2).toBe(top[index]!);
      expect(slot.isFallback).toBe(slot.channel === 1);
    });
    const count = (channel: number) =>
      table.filter((slot) => slot.channel === channel).length;
    expect(count(2)).toBe(3);
    expect(count(3)).toBe(2);
    expect(count(1)).toBe(3);
  });

  it("mirrors the engine table used by the transport tests", () => {
    // Same fixture as cseq-transport's euclid tests: [2, 3, 1, 1].
    expect(
      euclidPartitionTable(4, [layer(2, 1), layer(3, 1)], 1).map(
        (slot) => slot.channel
      )
    ).toEqual([2, 3, 1, 1]);
  });
});

describe("euclidStackTable", () => {
  it("shadows by priority, supports polymeter and inversion", () => {
    const layers = [
      layer(2, 1, { steps: 4 }),
      layer(3, 1, { steps: 3 }),
    ];
    expect(euclidStackPeriod(layers)).toBe(12);
    const table = euclidStackTable(layers, 1, 12);
    expect(table[0]!.channel).toBe(2); // both fire; priority shadows
    expect(table[3]!.channel).toBe(3);
    expect(table[4]!.channel).toBe(2);
    expect(table[6]!.channel).toBe(3);
    expect(table[1]!.channel).toBe(1);
    expect(table[1]!.isFallback).toBe(true);

    const inverted = euclidStackTable(
      [layer(2, 1, { steps: 4, invert: true })],
      1,
      4
    );
    expect(inverted.map((slot) => slot.channel)).toEqual([1, 2, 2, 2]);
  });
});

describe("seedEuclidLayersFromChannels", () => {
  it("spreads pulses by largest remainder across the palette", () => {
    expect(
      seedEuclidLayersFromChannels([1, 2, 3], 16).map((seeded) => [
        seeded.channel,
        seeded.pulses,
      ])
    ).toEqual([
      [1, 6],
      [2, 5],
      [3, 5],
    ]);
    expect(seedEuclidLayersFromChannels([], 16)).toEqual([]);
  });
});

describe("canonicalEuclidLayersForChannels", () => {
  it("preserves priority while dropping disabled and duplicate channels", () => {
    const first = layer(2, 3);
    const duplicate = layer(2, 1, { rotation: 1 });
    const disabled = layer(4, 1);
    const last = layer(3, 2);

    expect(
      canonicalEuclidLayersForChannels(
        [first, duplicate, disabled, last],
        [1, 2, 3]
      )
    ).toEqual([first, last]);
  });
});

describe("interval vectors and Euclidean strings", () => {
  const iv = (pulses: number, steps: number) =>
    intervalVector(bjorklundMask(pulses, steps));

  it("computes the adjacent inter-onset interval vector", () => {
    expect(iv(5, 9)).toEqual([2, 2, 2, 2, 1]);
    expect(iv(4, 9)).toEqual([2, 2, 2, 3]);
    expect(iv(5, 16)).toEqual([3, 3, 3, 3, 4]);
    expect(iv(7, 12)).toEqual([2, 1, 2, 2, 1, 2, 2]);
    expect(iv(4, 11)).toEqual([3, 3, 3, 2]);
    expect(iv(1, 9)).toEqual([9]);
    expect(intervalVector([false, false])).toEqual([]);
  });

  it("classifies Euclidean and reverse Euclidean strings per the literature", () => {
    // Classifications from the Louridas assignment's expected outputs.
    expect(isEuclideanString(iv(4, 9))).toBe(true); // (2223)
    expect(isEuclideanString(iv(5, 16))).toBe(true); // (33334)
    expect(isEuclideanString(iv(2, 9))).toBe(true); // (45)
    expect(isReverseEuclideanString(iv(5, 9))).toBe(true); // (22221)
    expect(isReverseEuclideanString(iv(4, 11))).toBe(true); // (3332)
    expect(isReverseEuclideanString(iv(7, 9))).toBe(true); // (2112111)
    expect(isEuclideanString(iv(7, 12))).toBe(false);
    expect(isReverseEuclideanString(iv(7, 12))).toBe(false);
    expect(isEuclideanString(iv(6, 12))).toBe(false); // (222222)
    expect(isEuclideanString(iv(3, 9))).toBe(false); // (333)
    expect(isEuclideanString(iv(1, 9))).toBe(false); // single interval
    expect(isEuclideanString([])).toBe(false);
  });
});
