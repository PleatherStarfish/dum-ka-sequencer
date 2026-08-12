export type UnlistenFn = () => void;

interface MockTauriDriver {
  listen<T>(
    eventName: string,
    handler: (event: { payload: T }) => void
  ): Promise<UnlistenFn>;
}

const DRIVER_WAIT_MS = 1_000;
const DRIVER_POLL_MS = 10;

declare global {
  interface Window {
    __CAESURA_E2E_DRIVER__?: MockTauriDriver;
  }
}

async function waitForDriver(eventName: string): Promise<MockTauriDriver> {
  const immediate = window.__CAESURA_E2E_DRIVER__;
  if (immediate) {
    return immediate;
  }

  const startedAt = performance.now();
  await new Promise<void>((resolve) => {
    const poll = () => {
      if (
        window.__CAESURA_E2E_DRIVER__ ||
        performance.now() - startedAt >= DRIVER_WAIT_MS
      ) {
        resolve();
        return;
      }
      window.setTimeout(poll, DRIVER_POLL_MS);
    };
    poll();
  });

  const driver = window.__CAESURA_E2E_DRIVER__;
  if (!driver) {
    throw new Error(
      `Missing Caesura e2e Tauri driver for ${eventName}. ` +
        "Open the app through the Playwright openCaesura() harness so installMockTauri() runs before app scripts."
    );
  }
  return driver;
}

export async function listen<T>(
  eventName: string,
  handler: (event: { payload: T }) => void
): Promise<UnlistenFn> {
  const driver = await waitForDriver(eventName);
  return await driver.listen(eventName, handler);
}
