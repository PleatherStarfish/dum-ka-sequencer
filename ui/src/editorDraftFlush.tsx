import { useEffect, useRef } from "react";

const DISCARD_EDITOR_DRAFTS_EVENT = "caesura:discard-editor-drafts";
const editorDraftFlushers = new Set<() => void>();

/**
 * Publishes registered component-local drafts without moving focus. Autosave
 * uses this path so it can capture in-progress authored text without
 * interrupting typing. The task yield lets React refresh document builders.
 */
export async function flushEditorDrafts(): Promise<void> {
  for (const flush of [...editorDraftFlushers]) {
    flush();
  }
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

/**
 * Manual Save also blurs an explicitly focused native control, covering older
 * blur-only editors. The shared flush then commits registered hidden drafts
 * and yields until both kinds of React updates have rendered.
 */
export async function flushFocusedEditorDraft(): Promise<void> {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    active.blur();
  }
  await flushEditorDrafts();
}

/** Cancels every component-local, not-yet-authored draft before document swap. */
export function discardEditorDrafts(): void {
  window.dispatchEvent(new Event(DISCARD_EDITOR_DRAFTS_EVENT));
}

export function useDiscardEditorDraft(reset: () => void): void {
  const resetRef = useRef(reset);
  resetRef.current = reset;
  useEffect(() => {
    const discard = () => resetRef.current();
    window.addEventListener(DISCARD_EDITOR_DRAFTS_EVENT, discard);
    return () => window.removeEventListener(DISCARD_EDITOR_DRAFTS_EVENT, discard);
  }, []);
}

/**
 * Registers a semantic draft commit for manual Save and normal panel unmount,
 * while a document replacement broadcasts a synchronous discard instead.
 */
export function useEditorDraftLifecycle(options: {
  flush: () => void;
  discard: () => void;
}): void {
  const flushRef = useRef(options.flush);
  const discardRef = useRef(options.discard);
  const discardedBeforeUnmountRef = useRef(false);
  flushRef.current = options.flush;
  discardRef.current = options.discard;
  // If the owner survives document replacement, its next committed render
  // starts a fresh lifecycle. Until then, the marker cannot expire merely
  // because React deferred the replacement unmount beyond a timer boundary.
  useEffect(() => {
    discardedBeforeUnmountRef.current = false;
  });
  useEffect(() => {
    const flush = () => flushRef.current();
    const discard = () => {
      discardedBeforeUnmountRef.current = true;
      discardRef.current();
    };
    editorDraftFlushers.add(flush);
    window.addEventListener(DISCARD_EDITOR_DRAFTS_EVENT, discard);
    return () => {
      editorDraftFlushers.delete(flush);
      window.removeEventListener(DISCARD_EDITOR_DRAFTS_EVENT, discard);
      if (!discardedBeforeUnmountRef.current) {
        flush();
      }
    };
  }, []);
}
