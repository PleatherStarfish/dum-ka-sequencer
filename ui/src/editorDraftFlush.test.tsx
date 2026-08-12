// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  discardEditorDrafts,
  flushEditorDrafts,
  flushFocusedEditorDraft,
  useDiscardEditorDraft,
  useEditorDraftLifecycle,
} from "./editorDraftFlush";

describe("flushFocusedEditorDraft", () => {
  it("publishes a focused blur-commit draft before returning to Save", async () => {
    let latestCommitted = "old";

    function Harness() {
      const [committed, setCommitted] = useState("old");
      const [draft, setDraft] = useState(committed);
      latestCommitted = committed;
      return (
        <input
          aria-label="draft"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => setCommitted(draft)}
        />
      );
    }

    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "draft" });
    input.focus();
    fireEvent.change(input, { target: { value: "visible draft" } });

    await act(flushFocusedEditorDraft);

    expect(latestCommitted).toBe("visible draft");
  });

  it("flushes a registered draft after its native editor is hidden", async () => {
    let committed = "old";

    function Harness({ editorVisible }: { editorVisible: boolean }) {
      const [draft, setDraft] = useState(committed);
      useEditorDraftLifecycle({
        flush: () => {
          committed = draft;
        },
        discard: () => setDraft(committed),
      });
      return editorVisible ? (
        <input
          aria-label="registered draft"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      ) : null;
    }

    const view = render(<Harness editorVisible />);
    fireEvent.change(screen.getByRole("textbox", { name: "registered draft" }), {
      target: { value: "hidden draft" },
    });
    view.rerender(<Harness editorVisible={false} />);

    await act(flushFocusedEditorDraft);

    expect(committed).toBe("hidden draft");
  });

  it("publishes a registered draft for autosave without moving focus", async () => {
    let committed = "old";

    function Harness() {
      const [draft, setDraft] = useState(committed);
      useEditorDraftLifecycle({
        flush: () => {
          committed = draft;
        },
        discard: () => setDraft(committed),
      });
      return (
        <input
          aria-label="autosave draft"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      );
    }

    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "autosave draft" });
    input.focus();
    fireEvent.change(input, { target: { value: "autosaved draft" } });

    await act(flushEditorDrafts);

    expect(committed).toBe("autosaved draft");
    expect(document.activeElement).toBe(input);
  });

  it("flushes a registered draft during a normal owner unmount", () => {
    let committed = "old";

    function Harness() {
      const [draft, setDraft] = useState(committed);
      useEditorDraftLifecycle({
        flush: () => {
          committed = draft;
        },
        discard: () => setDraft(committed),
      });
      return (
        <input
          aria-label="unmount draft"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      );
    }

    const view = render(<Harness />);
    fireEvent.change(screen.getByRole("textbox", { name: "unmount draft" }), {
      target: { value: "unmounted draft" },
    });
    view.unmount();

    expect(committed).toBe("unmounted draft");
  });

  it("discards a same-value cross-document local draft without committing it", async () => {
    let committed = "same in both documents";

    function Harness() {
      const [draft, setDraft] = useState(committed);
      useDiscardEditorDraft(() => setDraft(committed));
      return (
        <input
          aria-label="cross-document draft"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => {
            committed = draft;
          }}
        />
      );
    }

    render(<Harness />);
    const input = screen.getByRole("textbox", {
      name: "cross-document draft",
    });
    fireEvent.change(input, { target: { value: "leaked draft" } });
    act(discardEditorDrafts);

    expect((input as HTMLInputElement).value).toBe("same in both documents");
    expect(committed).toBe("same in both documents");
    await act(() => new Promise<void>((resolve) => window.setTimeout(resolve, 0)));
  });

  it("suppresses lifecycle commit when a document discard unmounts the owner", async () => {
    let committed = "same in both documents";

    function Harness() {
      const [draft, setDraft] = useState(committed);
      useEditorDraftLifecycle({
        flush: () => {
          committed = draft;
        },
        discard: () => setDraft(committed),
      });
      return (
        <input
          aria-label="discarded owner draft"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      );
    }

    const view = render(<Harness />);
    fireEvent.change(
      screen.getByRole("textbox", { name: "discarded owner draft" }),
      { target: { value: "must not leak" } }
    );
    act(() => {
      discardEditorDrafts();
      view.unmount();
    });

    expect(committed).toBe("same in both documents");
    await act(() => new Promise<void>((resolve) => window.setTimeout(resolve, 0)));
  });

  it("keeps discard suppression through a delayed owner unmount", async () => {
    const flush = vi.fn();

    function Harness() {
      useEditorDraftLifecycle({ flush, discard: () => undefined });
      return null;
    }

    const view = render(<Harness />);
    act(discardEditorDrafts);
    await act(() => new Promise<void>((resolve) => window.setTimeout(resolve, 0)));
    view.unmount();

    expect(flush).not.toHaveBeenCalled();
  });
});
