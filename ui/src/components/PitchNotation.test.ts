// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";

import {
  PITCH_COLLECTION_MENU_DESIRED_HEIGHT,
  PITCH_COLLECTION_MENU_MIN_HEIGHT,
  PITCH_COLLECTION_GROUPS,
  PitchCollectionSearchDropdown,
  fitPitchCollectionMenu,
} from "./PitchNotation";
import { LIMITED_TRANSPOSITION_COLLECTIONS } from "../patchIo";

/**
 * Regression for the Pitch Map Collection dropdown clipping bug: the results
 * popover is `position: absolute` inside `.shaper-body` (`overflow: hidden auto`).
 * When it rendered taller than that scroll ancestor, the ancestor clipped the
 * lower options and they became unclickable (the user could not select most
 * collections). `fitPitchCollectionMenu` caps the popover to the clip so every
 * option stays reachable via the popover's own internal scroll.
 */
describe("fitPitchCollectionMenu", () => {
  it("opens downward at full height when there is ample room below", () => {
    // Control at y[300,340]; clip is the viewport [0,900] — lots of room below.
    const p = fitPitchCollectionMenu(300, 340, 0, 900);
    expect(p.direction).toBe("down");
    expect(p.maxHeight).toBe(PITCH_COLLECTION_MENU_DESIRED_HEIGHT);
  });

  it("caps the height to the scroll-clip bottom so nothing is clipped (the bug)", () => {
    // The reproduced case: control bottom 350, but `.shaper-body` clips at 621.
    const clipBottom = 621;
    const controlBottom = 350;
    const p = fitPitchCollectionMenu(310, controlBottom, 99, clipBottom);
    expect(p.direction).toBe("down");
    // The popover's bottom (controlBottom + gap + maxHeight) must not exceed the clip.
    expect(controlBottom + 8 + p.maxHeight).toBeLessThanOrEqual(clipBottom);
    // ...and it is smaller than the unconstrained desired height.
    expect(p.maxHeight).toBeLessThan(PITCH_COLLECTION_MENU_DESIRED_HEIGHT);
  });

  it("flips upward when below is cramped and above is roomier", () => {
    // Control near the bottom of the clip: only ~30px below, ~500px above.
    const p = fitPitchCollectionMenu(560, 590, 60, 620);
    expect(p.direction).toBe("up");
    // Upward popover top (controlTop - gap - maxHeight) must stay within the clip.
    expect(590 - 30).toBeGreaterThan(0); // sanity: below space ~30 < min
    expect(560 - 8 - p.maxHeight).toBeGreaterThanOrEqual(60);
  });

  it("never collapses below the minimum height even in a tiny clip", () => {
    // Pathological: almost no room either side.
    const p = fitPitchCollectionMenu(300, 340, 290, 360);
    expect(p.maxHeight).toBe(PITCH_COLLECTION_MENU_MIN_HEIGHT);
  });

  it("prefers downward on a tie so placement is stable", () => {
    // Equal room above and below: stay down (openUp requires above > below).
    const p = fitPitchCollectionMenu(400, 440, 200, 640);
    expect(p.direction).toBe("down");
  });
});

describe("PitchCollectionSearchDropdown", () => {
  it("keeps the menu mounted long enough to choose a collection by mouse", () => {
    const changes: string[] = [];
    render(
      createElement(PitchCollectionSearchDropdown, {
        value: "chromatic",
        presets: LIMITED_TRANSPOSITION_COLLECTIONS,
        groups: PITCH_COLLECTION_GROUPS,
        onChange: (id: string) => changes.push(id),
      })
    );

    const input = screen.getByRole("combobox", { name: "Collection" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "major ionian" } });

    const option = screen.getByRole("option", { name: /Major \(Ionian\)/i });
    const mouseDown = createEvent.mouseDown(option, {
      bubbles: true,
      cancelable: true,
    });
    fireEvent(option, mouseDown);

    expect(mouseDown.defaultPrevented).toBe(true);
    fireEvent.click(option);
    expect(changes).toEqual(["major"]);
  });
});
