import { expect, test, type Page } from "@playwright/test";
import Color from "colorjs.io";

import {
  closeMainEditor,
  openCaesura,
  openMainEditor,
  type MainEditorId,
} from "./support/appHarness";

type ThemeMode = "dark" | "light";

type ContrastPair = {
  label: string;
  foreground: string;
  background: string;
  minimum: number;
  kind: "text" | "non-text";
};

type ResolvedContrastPair = ContrastPair & {
  computedForeground: string;
  computedBackground: string;
  ratio: number;
};

type DarkContainerLeak = {
  sel: string;
  bg: string;
  lum: number;
};

const THEME_STORAGE_KEY = "caesura.theme.v1";
const THEMES: ThemeMode[] = ["dark", "light"];
const MAIN_EDITORS: MainEditorId[] = ["boundaries", "channel"];

const WCAG_AA_NORMAL_TEXT = 4.5;
const WCAG_NON_TEXT = 3;
// Muted Astral body/secondary text is intentionally calm/low-contrast
// (docs/DESIGN_LANGUAGE.md): legible (>= 3:1) but not held to 4.5:1 AA.
const LEGIBILITY_FLOOR = 3;

const SEMANTIC_CONTRAST_PAIRS: ContrastPair[] = [
  {
    label: "body text on app background",
    foreground: "var(--text)",
    background: "var(--bg)",
    minimum: LEGIBILITY_FLOOR,
    kind: "text",
  },
  {
    label: "body text on primary panel",
    foreground: "var(--text)",
    background: "var(--panel)",
    minimum: LEGIBILITY_FLOOR,
    kind: "text",
  },
  {
    label: "body text on recessed surface",
    foreground: "var(--text)",
    background: "var(--surface-0)",
    minimum: LEGIBILITY_FLOOR,
    kind: "text",
  },
  {
    label: "muted text on primary panel",
    foreground: "var(--muted)",
    background: "var(--panel)",
    minimum: LEGIBILITY_FLOOR,
    kind: "text",
  },
  {
    label: "muted text on recessed surface",
    foreground: "var(--muted)",
    background: "var(--surface-0)",
    minimum: LEGIBILITY_FLOOR,
    kind: "text",
  },
  {
    label: "cyan filled command text",
    foreground: "var(--accent-ink)",
    background: "var(--accent)",
    minimum: WCAG_AA_NORMAL_TEXT,
    kind: "text",
  },
  {
    label: "green enabled command text",
    foreground: "var(--accent-ink)",
    background: "var(--green)",
    minimum: WCAG_AA_NORMAL_TEXT,
    kind: "text",
  },
  {
    label: "yellow timeline label text",
    foreground: "var(--base03)",
    background: "var(--yellow)",
    minimum: WCAG_AA_NORMAL_TEXT,
    kind: "text",
  },
  {
    label: "hot focus line on app background",
    foreground: "var(--line-hot)",
    background: "var(--bg)",
    minimum: WCAG_NON_TEXT,
    kind: "non-text",
  },
  {
    label: "magenta focus line on app background",
    foreground: "var(--accent-strong)",
    background: "var(--bg)",
    minimum: WCAG_NON_TEXT,
    kind: "non-text",
  },
];

/**
 * Light-mode leak guard for the Solarized Astral theme.
 *
 * The theme is a token layer over a large, partly pre-Astral stylesheet. This
 * catches hardcoded dark panels that ignore the light theme. Text contrast is
 * checked separately with axe and colorjs.io.
 */
async function setTheme(page: Page, mode: ThemeMode) {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: THEME_STORAGE_KEY, value: mode }
  );
}

/** Relative luminance (0..1) of an `rgb(...)`/`rgba(...)` string. */
const LUM_FN = `(css) => {
  const m = css.match(/rgba?\\(([^)]+)\\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s));
  const [r, g, b, a = 1] = parts;
  if (a === 0) return null;
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
}`;

function formatRatio(value: number): string {
  return value.toFixed(2);
}

async function resolvedContrastPairs(
  page: Page
): Promise<ResolvedContrastPair[]> {
  const resolved = await page.evaluate((pairs) => {
    return pairs.map((pair) => {
      const probe = document.createElement("span");
      probe.textContent = "Aa";
      probe.setAttribute("aria-hidden", "true");
      probe.style.position = "fixed";
      probe.style.left = "-10000px";
      probe.style.top = "-10000px";
      probe.style.color = pair.foreground;
      probe.style.background = pair.background;
      document.body.appendChild(probe);
      const style = getComputedStyle(probe);
      const output = {
        ...pair,
        computedForeground: style.color,
        computedBackground: style.backgroundColor,
      };
      probe.remove();
      return output;
    });
  }, SEMANTIC_CONTRAST_PAIRS);

  return resolved.map((pair) => ({
    ...pair,
    ratio: Color.contrastWCAG21(pair.computedForeground, pair.computedBackground),
  }));
}

async function expectSemanticContrastPairs(
  page: Page,
  context: string
): Promise<void> {
  const pairs = await resolvedContrastPairs(page);
  const failures = pairs
    .filter((pair) => pair.ratio < pair.minimum)
    .map(
      (pair) =>
        `${pair.label} (${pair.kind}) ${pair.computedForeground} on ${pair.computedBackground}: ${formatRatio(
          pair.ratio
        )}:1, expected >= ${pair.minimum}:1`
    );

  expect(
    failures,
    `${context} semantic color contrast failures:\n${failures.join("\n")}`
  ).toEqual([]);
}

async function darkContainerLeaks(
  page: Page,
  maxLum = 0.22,
  minArea = 1600
): Promise<DarkContainerLeak[]> {
  return page.evaluate(
    ({ lumSrc, maxLum, minArea }) => {
      const lum = eval(lumSrc) as (css: string) => number | null;
      const sat = (css: string) => {
        const m = css.match(/rgba?\(([^)]+)\)/);
        if (!m) return 0;
        const [r, g, b] = m[1].split(",").map((s) => parseFloat(s) / 255);
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        return mx === 0 ? 0 : (mx - mn) / mx;
      };
      const out: DarkContainerLeak[] = [];
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>("body *")
      )) {
        const r = el.getBoundingClientRect();
        if (r.width * r.height < minArea) continue;
        if (r.width === 0 || r.height === 0) continue;
        const cls0 = typeof el.className === "string" ? el.className : "";
        if (/backdrop|scrim|overlay-dim/.test(cls0)) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        const bg = cs.backgroundColor;
        const L = lum(bg);
        if (L === null) continue;
        if (L >= maxLum) continue;
        if (sat(bg) >= 0.4) continue;
        const id = el.id ? `#${el.id}` : "";
        const cls =
          el.className && typeof el.className === "string"
            ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
            : "";
        out.push({
          sel: `${el.tagName.toLowerCase()}${id}${cls}`,
          bg,
          lum: Math.round(L * 1000) / 1000,
        });
      }
      const seen = new Set<string>();
      return out.filter((o) =>
        seen.has(o.sel) ? false : (seen.add(o.sel), true)
      );
    },
    { lumSrc: LUM_FN, maxLum, minArea }
  );
}

test.describe("Solarized Astral contrast", () => {
  test.describe.configure({ timeout: 75_000 });

  for (const theme of THEMES) {
    test(`${theme} mode passes rendered text and semantic pair contrast`, async ({
      page,
    }) => {
      await setTheme(page, theme);
      await openCaesura(page);

      await expect(page.locator(":root")).toHaveAttribute("data-theme", theme);
      await expectSemanticContrastPairs(page, `${theme} main view`);

      for (const editor of MAIN_EDITORS) {
        await openMainEditor(page, editor);
        await expectSemanticContrastPairs(page, `${theme} ${editor} editor`);
        await closeMainEditor(page);
      }
    });
  }

  test("light mode renders light with no dark-container leaks in main and seed dialog", async ({
    page,
  }) => {
    await setTheme(page, "light");
    await openCaesura(page);

    await expect(page.locator(":root")).toHaveAttribute("data-theme", "light");
    const bodyLum = await page.evaluate(
      (s) =>
        (eval(s) as (c: string) => number)(
          getComputedStyle(document.body).backgroundColor
        ),
      LUM_FN
    );
    expect(bodyLum, "light-mode body background should be light").toBeGreaterThan(
      0.6
    );

    let leaks = await darkContainerLeaks(page);
    expect(
      leaks,
      `dark-container leaks on main view: ${JSON.stringify(leaks, null, 2)}`
    ).toEqual([]);

    await page.locator(".seed-loop-monitor").click();
    await expect(page.getByRole("dialog", { name: "Seed Strategy" })).toBeVisible();
    leaks = await darkContainerLeaks(page);
    expect(
      leaks,
      `dark-container leaks with Seed Strategy open: ${JSON.stringify(
        leaks,
        null,
        2
      )}`
    ).toEqual([]);
  });
});
