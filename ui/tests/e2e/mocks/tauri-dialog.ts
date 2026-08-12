interface MockTauriDriver {
  dialog<T>(kind: "ask" | "open" | "save", options?: unknown): Promise<T>;
}

declare global {
  interface Window {
    __CAESURA_E2E_DRIVER__?: MockTauriDriver;
  }
}

export async function ask(message: string, options?: unknown): Promise<boolean> {
  return (
    (await window.__CAESURA_E2E_DRIVER__?.dialog<boolean>("ask", {
      message,
      options,
    })) ?? false
  );
}

export async function open(options?: unknown): Promise<string | string[] | null> {
  return (
    (await window.__CAESURA_E2E_DRIVER__?.dialog<string | string[] | null>(
      "open",
      options
    )) ?? null
  );
}

export async function save(options?: unknown): Promise<string | null> {
  return (
    (await window.__CAESURA_E2E_DRIVER__?.dialog<string | null>("save", options)) ??
    null
  );
}
