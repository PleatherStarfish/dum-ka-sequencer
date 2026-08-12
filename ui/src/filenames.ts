/**
 * Pure filename helpers, extracted from App.tsx so they can be unit-tested
 * directly (see filenames.test.ts). These derive default save-dialog filenames
 * from a user-facing name and pull the basename out of a path.
 *
 * Part of the incremental App.tsx extraction effort — see docs/TESTING.md.
 */
import { TRACK_FILE_EXTENSION } from "./patchIo";

/**
 * Lowercase, collapse anything outside [a-z0-9._-] to single hyphens, trim
 * leading/trailing hyphens. Falls back to `fallback` when the result is empty.
 */
export function slugifyName(name: string, fallback: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

export function defaultPatchFilename(name: string): string {
  return `${slugifyName(name, "untitled")}.dumka`;
}

export function defaultScoreFilename(name: string): string {
  return `${slugifyName(name, "untitled")}.dumka-cycle.json`;
}

export function defaultTrackFilename(trackName: string): string {
  return `${slugifyName(trackName, "track")}.${TRACK_FILE_EXTENSION}`;
}

/** The final path segment, tolerant of both `/` and `\` separators. */
export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
