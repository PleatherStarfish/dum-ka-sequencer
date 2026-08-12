import { test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

import {
  closeMainEditor,
  openCaesura,
  openMainEditor,
  waitForIdle,
  waitForPlaying,
  type MainEditorId,
} from "./support/appHarness";

type CssStyleSheetHeader = {
  styleSheetId: string;
  sourceURL?: string;
  origin?: string;
};

type RuleUsage = {
  styleSheetId: string;
  startOffset: number;
  endOffset: number;
  used: boolean;
};

type SelectorObservation = {
  selector: string;
  baseSelector: string;
  exactMatched: boolean;
  baseMatched: boolean;
  transientPseudos: string[];
};

type SelectorMatchRecord = {
  selector: string;
  baseSelector: string;
  exactContexts: Set<string>;
  baseContexts: Set<string>;
  transientPseudos: Set<string>;
};

type SelectorMatchMap = Map<string, SelectorMatchRecord>;

type SelectorArmReportEntry = {
  selector: string;
  selectorGroup: string;
  line: number;
  bytes: number;
  coverageUsed: boolean;
  exactMatched: boolean;
  baseMatched: boolean;
  exactContexts: string[];
  baseContexts: string[];
  transientPseudos: string[];
};

type SheetReport = {
  url: string;
  totalRules: number;
  totalSelectorArms: number;
  coverageUsedRules: number;
  coverageUnusedRules: number;
  exactMatchedArms: number;
  baseOnlyMatchedArms: number;
  unmatchedArms: number;
  coverageUsedBytes: number;
  coverageUnusedBytes: number;
  unmatched: SelectorArmReportEntry[];
  baseOnly: SelectorArmReportEntry[];
};

const REPORT_DIR = path.resolve("coverage/css-dead-selectors");
const REPORT_JSON = path.join(REPORT_DIR, "report.json");
const REPORT_MD = path.join(REPORT_DIR, "report.md");

const COVERAGE_SCENARIOS = [
  { name: "desktop", viewport: { width: 1440, height: 1000 } },
  { name: "narrow", viewport: { width: 900, height: 900 } },
  { name: "mobile", viewport: { width: 390, height: 844 } },
] as const;

test.describe("CSS dead-selector report", () => {
  test.setTimeout(120_000);

  test.skip(
    process.env.CAESURA_CSS_COVERAGE !== "1",
    "Set CAESURA_CSS_COVERAGE=1 or run pnpm css:dead-selectors"
  );

  test("records CSS rule usage over a representative app journey", async ({ page }) => {
    await page.setViewportSize(COVERAGE_SCENARIOS[0].viewport);
    const coverage = await startCssRuleCoverage(page);

    const selectorMatches: SelectorMatchMap = new Map();
    await exerciseApp(page, selectorMatches);

    const sheets = await coverage.stop();
    const report = buildReport(sheets, selectorMatches);
    await writeReport(report);
  });
});

async function startCssRuleCoverage(page: Page) {
  const client = await page.context().newCDPSession(page);
  const headers = new Map<string, CssStyleSheetHeader>();

  client.on("CSS.styleSheetAdded", ({ header }) => {
    headers.set(header.styleSheetId, header);
  });

  await client.send("DOM.enable");
  await client.send("CSS.enable");
  await client.send("CSS.startRuleUsageTracking");

  return {
    async stop() {
      const { ruleUsage } = (await client.send("CSS.stopRuleUsageTracking")) as {
        ruleUsage: RuleUsage[];
      };
      const bySheet = new Map<string, RuleUsage[]>();
      for (const usage of ruleUsage) {
        if (usage.endOffset <= usage.startOffset) continue;
        const list = bySheet.get(usage.styleSheetId) ?? [];
        list.push(usage);
        bySheet.set(usage.styleSheetId, list);
      }

      const sheets: Array<{
        header: CssStyleSheetHeader;
        text: string;
        usage: RuleUsage[];
      }> = [];
      for (const [styleSheetId, usage] of bySheet) {
        const header = headers.get(styleSheetId);
        if (!header) continue;
        try {
          const { text } = (await client.send("CSS.getStyleSheetText", {
            styleSheetId,
          })) as { text: string };
          sheets.push({ header, text, usage });
        } catch {
          // Stylesheet may have been detached by HMR or navigation; it cannot
          // be reported reliably, so skip it rather than failing the report.
        }
      }
      await client.detach();
      return sheets;
    },
  };
}

async function exerciseApp(
  page: Page,
  selectorMatches: SelectorMatchMap
): Promise<void> {
  await openCaesura(page, { divergentRealizedRhythm: true });
  for (const scenario of COVERAGE_SCENARIOS) {
    await page.setViewportSize(scenario.viewport);
    await page.waitForTimeout(120);
    await exerciseScenario(page, selectorMatches, scenario.name);
  }
}

async function exerciseScenario(
  page: Page,
  selectorMatches: SelectorMatchMap,
  scenarioName: string
): Promise<void> {
  await sampleDomSelectorMatches(page, selectorMatches, `${scenarioName}: shell`);

  await openDetailsIfClosed(page.locator(".panel-state-midi"));
  await openDetailsIfClosed(page.locator(".timeline-info"));
  await hoverIfPresent(page.getByTestId("transport-play"));
  await sampleDomSelectorMatches(page, selectorMatches, `${scenarioName}: shell details`);

  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);
  await page.waitForTimeout(200);
  await sampleDomSelectorMatches(page, selectorMatches, `${scenarioName}: playing`);
  await hoverIfPresent(page.getByTestId("transport-stop"));
  await page.getByTestId("transport-stop").click();
  await waitForIdle(page);
  await sampleDomSelectorMatches(page, selectorMatches, `${scenarioName}: idle`);

  const editors: MainEditorId[] = [
    "shape",
    "boundaries",
    "rhythm",
    "pitch",
    "channel",
    "randomize",
  ];
  for (const editor of editors) {
    const panel = await openMainEditor(page, editor);
    await hoverIfPresent(page.getByTestId(`main-editor-launcher-${editor}`));
    await revealPanelStates(panel);
    await scrollPanel(panel);
    await sampleDomSelectorMatches(
      page,
      selectorMatches,
      `${scenarioName}: ${editor} editor`
    );

    if (editor === "rhythm") {
      await clickIfPresent(panel.getByRole("button", { name: "Learn from passage" }));
      await sampleDomSelectorMatches(
        page,
        selectorMatches,
        `${scenarioName}: rhythm passage`
      );
      await clickIfPresent(page.getByRole("button", { name: "Open passage fit guide" }));
      await sampleDomSelectorMatches(
        page,
        selectorMatches,
        `${scenarioName}: rhythm fit guide`
      );
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    }

    if (editor === "randomize") {
      await clickIfPresent(panel.getByRole("switch", { name: "Channel" }));
      await clickIfPresent(panel.getByTestId("randomize-rhythm-advanced-source-advanced"));
      await clickIfPresent(panel.getByTestId("randomize-pitch-advanced-source-advanced"));
      await scrollPanel(panel);
      await sampleDomSelectorMatches(
        page,
        selectorMatches,
        `${scenarioName}: randomize advanced`
      );
    }

    await closeMainEditor(page);
    await sampleDomSelectorMatches(
      page,
      selectorMatches,
      `${scenarioName}: ${editor} closed`
    );
  }
}

async function revealPanelStates(locator: Locator): Promise<void> {
  const summaries = locator.locator("summary");
  const count = await summaries.count();
  for (let index = 0; index < Math.min(count, 32); index += 1) {
    const summary = summaries.nth(index);
    const shouldOpen = await summary
      .evaluate((element) => {
        if (
          element.classList.contains("editor-panel-summary") ||
          element.classList.contains("shaper-summary")
        ) {
          return false;
        }
        const details = element.parentElement;
        return details instanceof HTMLDetailsElement && !details.open;
      })
      .catch(() => false);
    if (shouldOpen) await clickIfPresent(summary);
  }
}

async function scrollPanel(locator: Locator): Promise<void> {
  await locator.evaluate((root) => {
    const elements = [root, ...Array.from(root.querySelectorAll("*"))];
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      if (element.scrollHeight > element.clientHeight) {
        element.scrollTop = element.scrollHeight;
      }
    }
  });
}

async function clickIfPresent(locator: Locator): Promise<void> {
  if ((await locator.count()) === 0) return;
  const first = locator.first();
  if (!(await first.isVisible().catch(() => false))) return;
  await first.click({ timeout: 1_500 }).catch(() => undefined);
}

async function hoverIfPresent(locator: Locator): Promise<void> {
  if ((await locator.count()) === 0) return;
  const first = locator.first();
  if (!(await first.isVisible().catch(() => false))) return;
  await first.hover({ timeout: 1_500 }).catch(() => undefined);
}

async function openDetailsIfClosed(locator: Locator): Promise<void> {
  if ((await locator.count()) === 0) return;
  const first = locator.first();
  const shouldOpen = await first
    .evaluate((element) => element instanceof HTMLDetailsElement && !element.open)
    .catch(() => false);
  if (shouldOpen) await clickIfPresent(first.locator("summary"));
}

async function sampleDomSelectorMatches(
  page: Page,
  out: SelectorMatchMap,
  context: string
): Promise<void> {
  const observations = await page.evaluate((): SelectorObservation[] => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    const splitSelectorList = (selectorText: string): string[] => {
      const parts: string[] = [];
      let current = "";
      let depth = 0;
      let quote: string | null = null;
      for (const char of selectorText) {
        if (quote) {
          current += char;
          if (char === quote) quote = null;
          continue;
        }
        if (char === "'" || char === '"') {
          quote = char;
          current += char;
          continue;
        }
        if (char === "(" || char === "[") depth += 1;
        if ((char === ")" || char === "]") && depth > 0) depth -= 1;
        if (char === "," && depth === 0) {
          parts.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      if (current.trim()) parts.push(current.trim());
      return parts;
    };
    const pseudoElementFree = (selector: string): string =>
      selector
        .replace(/::[a-zA-Z-]+(?:\([^)]*\))?/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const transientPseudosIn = (selector: string): string[] => {
      const pseudos = new Set<string>();
      for (const match of selector.matchAll(
        /:(focus-visible|focus-within|hover|active|focus|visited)\b/gi
      )) {
        pseudos.add(`:${match[1].toLowerCase()}`);
      }
      return [...pseudos].sort();
    };
    const baseSelectorForCoverage = (selector: string): string =>
      pseudoElementFree(selector)
        .replace(/:(?:focus-visible|focus-within|hover|active|focus|visited)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    const queryMatches = (selector: string): boolean => {
      const query = selector.trim();
      if (!query) return false;
      try {
        return document.querySelector(query) !== null;
      } catch {
        return false;
      }
    };
    const visitRules = (rules: CSSRuleList, matches: SelectorObservation[]): void => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
          for (const selector of splitSelectorList(rule.selectorText)) {
            const cleanSelector = normalize(selector);
            const exactSelector = pseudoElementFree(cleanSelector);
            const baseSelector = baseSelectorForCoverage(cleanSelector);
            matches.push({
              selector: cleanSelector,
              baseSelector,
              exactMatched: queryMatches(exactSelector),
              baseMatched: queryMatches(baseSelector),
              transientPseudos: transientPseudosIn(cleanSelector),
            });
          }
          continue;
        }
        const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
        if (nested) visitRules(nested, matches);
      }
    };

    const matches: SelectorObservation[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        if (sheet.href && !new URL(sheet.href).pathname.endsWith("/src/styles.css")) {
          continue;
        }
        visitRules(sheet.cssRules, matches);
      } catch {
        // Cross-origin stylesheets are not expected here, but skip if any appear.
      }
    }
    return matches;
  });
  for (const observation of observations) {
    recordSelectorObservation(out, observation, context);
  }
}

function recordSelectorObservation(
  out: SelectorMatchMap,
  observation: SelectorObservation,
  context: string
): void {
  const keys = new Set([
    normalizeSelector(observation.selector),
    canonicalSelectorKey(observation.selector),
  ]);
  for (const key of keys) {
    const record =
      out.get(key) ??
      ({
        selector: observation.selector,
        baseSelector: observation.baseSelector,
        exactContexts: new Set<string>(),
        baseContexts: new Set<string>(),
        transientPseudos: new Set<string>(),
      } satisfies SelectorMatchRecord);
    if (observation.exactMatched) record.exactContexts.add(context);
    if (observation.baseMatched) record.baseContexts.add(context);
    for (const pseudo of observation.transientPseudos) {
      record.transientPseudos.add(pseudo);
    }
    out.set(key, record);
  }
}

function buildReport(
  sheets: Array<{ header: CssStyleSheetHeader; text: string; usage: RuleUsage[] }>,
  selectorMatches: SelectorMatchMap
) {
  const generatedAt = new Date().toISOString();
  const sheetReports = sheets
    .filter(({ header, text }) => isStylesCss(header, text))
    .map(({ header, text, usage }): SheetReport => {
      const unique = uniqueRuleUsage(usage);
      const ruleEntries = unique.map((rule) => {
        const start = clampOffset(rule.startOffset, text);
        const end = clampOffset(rule.endOffset, text);
        const ruleText = text.slice(start, end);
        const selector = selectorForRule(ruleText);
        return {
          selector,
          line: lineForOffset(text, start),
          bytes: Math.max(0, end - start),
          coverageUsed: rule.used,
        };
      });
      const armEntries = ruleEntries.flatMap((rule): SelectorArmReportEntry[] =>
        splitSelectorList(rule.selector).map((selector) => {
          const match =
            selectorMatches.get(normalizeSelector(selector)) ??
            selectorMatches.get(canonicalSelectorKey(selector));
          const exactContexts = match ? [...match.exactContexts].sort() : [];
          const baseContexts = match ? [...match.baseContexts].sort() : [];
          return {
            selector,
            selectorGroup: rule.selector,
            line: rule.line,
            bytes: rule.bytes,
            coverageUsed: rule.coverageUsed,
            exactMatched: exactContexts.length > 0,
            baseMatched: baseContexts.length > 0,
            exactContexts,
            baseContexts,
            transientPseudos: match ? [...match.transientPseudos].sort() : [],
          };
        })
      );
      const coverageUsedRules = ruleEntries.filter((entry) => entry.coverageUsed);
      const coverageUnusedRules = ruleEntries.filter((entry) => !entry.coverageUsed);
      const exactMatchedArms = armEntries.filter((entry) => entry.exactMatched);
      const baseOnlyMatchedArms = armEntries.filter(
        (entry) => !entry.exactMatched && entry.baseMatched
      );
      const unmatchedArms = armEntries.filter((entry) => !entry.baseMatched);
      return {
        url: header.sourceURL || "(inline stylesheet)",
        totalRules: ruleEntries.length,
        totalSelectorArms: armEntries.length,
        coverageUsedRules: coverageUsedRules.length,
        coverageUnusedRules: coverageUnusedRules.length,
        exactMatchedArms: exactMatchedArms.length,
        baseOnlyMatchedArms: baseOnlyMatchedArms.length,
        unmatchedArms: unmatchedArms.length,
        coverageUsedBytes: coverageUsedRules.reduce(
          (sum, entry) => sum + entry.bytes,
          0
        ),
        coverageUnusedBytes: coverageUnusedRules.reduce(
          (sum, entry) => sum + entry.bytes,
          0
        ),
        unmatched: unmatchedArms
          .sort((a, b) => b.bytes - a.bytes || a.line - b.line)
          .slice(0, 500),
        baseOnly: baseOnlyMatchedArms
          .sort(
            (a, b) =>
              b.transientPseudos.length - a.transientPseudos.length || a.line - b.line
          )
          .slice(0, 500),
      };
    });

  return {
    generatedAt,
    scenario:
      "Desktop/narrow/mobile: open shell, play/stop transport, open all six main editors, reveal details, open key nested rhythm/randomize states.",
    note:
      "Coverage is journey-limited. Unmatched selector arms are candidates for manual review, not automatic deletions; base-only matches mean the underlying element existed but a transient state such as hover/focus was not observed exactly.",
    sheets: sheetReports,
  };
}

function uniqueRuleUsage(usage: RuleUsage[]): RuleUsage[] {
  const byRange = new Map<string, RuleUsage>();
  for (const rule of usage) {
    const key = `${rule.styleSheetId}:${rule.startOffset}:${rule.endOffset}`;
    const existing = byRange.get(key);
    byRange.set(key, existing ? { ...rule, used: existing.used || rule.used } : rule);
  }
  return [...byRange.values()].sort((a, b) => a.startOffset - b.startOffset);
}

function isStylesCss(header: CssStyleSheetHeader, text: string): boolean {
  const url = header.sourceURL ?? "";
  return (
    url.endsWith("/src/styles.css") ||
    url.endsWith("styles.css") ||
    text.includes(".transport-cluster") ||
    text.includes(".main-editor-launcher")
  );
}

function selectorForRule(ruleText: string): string {
  const braceIndex = ruleText.indexOf("{");
  return (braceIndex >= 0 ? ruleText.slice(0, braceIndex) : ruleText)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSelectorList(selectorText: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;
  for (const char of selectorText) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "[") depth += 1;
    if ((char === ")" || char === "]") && depth > 0) depth -= 1;
    if (char === "," && depth === 0) {
      if (current.trim()) parts.push(normalizeSelector(current));
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(normalizeSelector(current));
  return parts;
}

function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, " ").trim();
}

function canonicalSelectorKey(selector: string): string {
  return normalizeSelector(selector)
    .replace(/\*::/g, "::")
    .replace(/:nth-child\(\s*even\s*\)/gi, ":nth-child(2n)")
    .replace(/:nth-child\(\s*odd\s*\)/gi, ":nth-child(2n+1)")
    .replace(/:nth-of-type\(\s*even\s*\)/gi, ":nth-of-type(2n)")
    .replace(/:nth-of-type\(\s*odd\s*\)/gi, ":nth-of-type(2n+1)");
}

function lineForOffset(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function clampOffset(offset: number, text: string): number {
  return Math.max(0, Math.min(text.length, Math.floor(offset)));
}

async function writeReport(report: ReturnType<typeof buildReport>): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(REPORT_MD, markdownReport(report));
}

function markdownReport(report: ReturnType<typeof buildReport>): string {
  const lines: string[] = [
    "# CSS Dead-Selector Coverage Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    report.note,
    "",
    `Scenario: ${report.scenario}`,
    "",
  ];

  if (report.sheets.length === 0) {
    lines.push("No `styles.css` stylesheet was captured.");
    return `${lines.join("\n")}\n`;
  }

  for (const sheet of report.sheets) {
    const totalBytes = sheet.coverageUsedBytes + sheet.coverageUnusedBytes;
    const coverageUnusedPct =
      totalBytes > 0 ? (sheet.coverageUnusedBytes / totalBytes) * 100 : 0;
    const unmatchedArmPct =
      sheet.totalSelectorArms > 0
        ? (sheet.unmatchedArms / sheet.totalSelectorArms) * 100
        : 0;
    const exactArmPct =
      sheet.totalSelectorArms > 0
        ? (sheet.exactMatchedArms / sheet.totalSelectorArms) * 100
        : 0;
    lines.push(`## ${sheet.url}`);
    lines.push("");
    lines.push(
      `- CDP rule coverage: ${sheet.coverageUsedRules}/${sheet.totalRules} used (${coverageUnusedPct.toFixed(
        1
      )}% bytes unused)`
    );
    lines.push(
      `- Selector arms: ${sheet.totalSelectorArms} total; ${sheet.exactMatchedArms} exact (${exactArmPct.toFixed(
        1
      )}%), ${sheet.baseOnlyMatchedArms} base-only state approximations, ${sheet.unmatchedArms} unmatched (${unmatchedArmPct.toFixed(
        1
      )}%)`
    );
    lines.push(`- Unmatched selector-arm candidates listed: ${sheet.unmatched.length}`);
    lines.push(`- Base-only state selectors listed: ${sheet.baseOnly.length}`);
    lines.push("");

    lines.push("### Unmatched Selector Arms");
    lines.push("");
    if (sheet.unmatched.length === 0) {
      lines.push("No unmatched selector arms in this sampled journey.");
    } else {
      lines.push("| Line | Rule Bytes | CDP Rule Used | Selector Arm | Group |");
      lines.push("| ---: | ---: | :---: | --- | --- |");
      for (const entry of sheet.unmatched.slice(0, 150)) {
        lines.push(
          `| ${entry.line} | ${entry.bytes} | ${
            entry.coverageUsed ? "yes" : "no"
          } | \`${markdownSelector(entry.selector)}\` | \`${markdownSelector(
            entry.selectorGroup
          )}\` |`
        );
      }
    }
    lines.push("");

    lines.push("### Base-Only State Selectors");
    lines.push("");
    if (sheet.baseOnly.length === 0) {
      lines.push("No selectors only matched after stripping transient state pseudos.");
    } else {
      lines.push("| Line | Pseudos | Base-Matched Contexts | Selector Arm |");
      lines.push("| ---: | --- | --- | --- |");
      for (const entry of sheet.baseOnly.slice(0, 150)) {
        lines.push(
          `| ${entry.line} | ${entry.transientPseudos.join(", ") || "-"} | ${
            entry.baseContexts.slice(0, 4).join("<br>") || "-"
          } | \`${markdownSelector(entry.selector)}\` |`
        );
      }
      lines.push("");
      lines.push(
        "These are not dead-code findings by themselves; they flag selectors whose underlying element appeared, while the exact hover/focus/active/visited state was not observed during sampling."
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function markdownSelector(selector: string): string {
  const shortened =
    selector.length > 220 ? `${selector.slice(0, 217)}...` : selector;
  return shortened.replaceAll("`", "\\`");
}
