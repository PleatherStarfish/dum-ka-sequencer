import { beforeEach, describe, expect, it } from "vitest";

import {
  datetimeSeed,
  readGlobalSeedStartupLock,
  writeGlobalSeedStartupLock,
} from "./sessionPrefs";

// sessionPrefs reads/writes window.localStorage. Rather than the (currently
// broken under this Node) jsdom environment, stub a tiny in-memory store so the
// localStorage round-trips run as fast pure-Node tests.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window =
    { localStorage: new MemoryStorage() };
});

describe("datetimeSeed", () => {
  it("is deterministic for a given moment", () => {
    const when = new Date(1_700_000_000_000);
    expect(datetimeSeed(when)).toBe(datetimeSeed(new Date(when.getTime())));
  });

  it("produces a non-negative finite seed that varies with time", () => {
    const a = datetimeSeed(new Date(1_700_000_000_000));
    const b = datetimeSeed(new Date(1_700_000_111_111));
    expect(Number.isFinite(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).not.toBe(b);
  });
});

describe("global seed startup lock round-trip", () => {
  it("defaults to unlocked when nothing is stored", () => {
    expect(readGlobalSeedStartupLock().locked).toBe(false);
  });

  it("persists and reads back a locked seed", () => {
    writeGlobalSeedStartupLock(true, 4242);
    expect(readGlobalSeedStartupLock()).toEqual({ locked: true, seed: 4242 });
  });

  it("clears the lock when locked is false", () => {
    writeGlobalSeedStartupLock(true, 4242);
    writeGlobalSeedStartupLock(false, 4242);
    expect(readGlobalSeedStartupLock().locked).toBe(false);
    expect(
      (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.getItem(
        "caesura.globalSeedStartupLock.v1"
      )
    ).toBeNull();
  });
});
