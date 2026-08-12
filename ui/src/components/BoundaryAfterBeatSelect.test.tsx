// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BoundaryAfterBeatSelect } from "./BoundaryAfterBeatSelect";

afterEach(cleanup);

describe("BoundaryAfterBeatSelect", () => {
  it("offers only free after-beat slots plus the current boundary", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <BoundaryAfterBeatSelect
        cycleBeats={6}
        boundaries={[{ afterBeat: 2 }, { afterBeat: 4 }]}
        value={4}
        onChange={onChange}
      />
    );

    const select = screen.getByRole("combobox", {
      name: "Boundary after beat",
    }) as HTMLSelectElement;

    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "1",
      "3",
      "4",
      "5",
    ]);

    await user.selectOptions(select, "3");

    expect(onChange).toHaveBeenCalledWith(3);
  });
});
