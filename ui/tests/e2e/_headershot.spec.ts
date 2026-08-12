import { test } from "@playwright/test";
import { openCaesura } from "./support/appHarness";

test("capture header both modes", async ({ page }) => {
  await openCaesura(page);
  const bar = page.locator(".top-bar");
  await page.waitForTimeout(250);
  await bar.screenshot({ path: "/tmp/header-dark.png" });

  const themeSwitch = page.getByRole("switch", { name: /theme/i });
  await themeSwitch.click();
  await page.waitForTimeout(300);
  await bar.screenshot({ path: "/tmp/header-light.png" });

  // back to dark to show the moon thumb close-up
  await themeSwitch.click();
  await page.waitForTimeout(300);
  await page.locator(".theme-switch").screenshot({ path: "/tmp/theme-switch-dark.png" });
  await themeSwitch.click();
  await page.waitForTimeout(300);
  await page.locator(".theme-switch").screenshot({ path: "/tmp/theme-switch-light.png" });
});
