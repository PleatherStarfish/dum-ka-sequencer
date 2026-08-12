#!/usr/bin/env python3
"""Perf-gate checker: compare bench outputs against scripts/perf-baseline.json.

Parses the raw stdout of the two perf harnesses:

  * backend  — `scripts/bench.sh` (the cseq-bench crate). Per case it prints:
        rhythm/enumerate-patterns-14
          enumerate 2^(14-1) ordered rhythm compositions
          min 71.2ms  median 72.1ms  mean 72.4ms  max 75.0ms  checksum 8192
    Durations are Rust `Duration` debug strings (ns / µs / ms / s, and the
    micro sign can be U+00B5 or U+03BC). The guarded number is the MEDIAN.

  * frontend — `pnpm --dir ui bench` (vitest bench). Per case it prints:
        · buildAutomationTargetDefs (full target enumeration)  277.29  3.0551 ...
    i.e. name then 10 columns: hz min max mean p75 p99 p995 p999 rme samples,
    optionally followed by a `fastest`/`slowest` tag. All times are ms; hz and
    samples carry thousands separators. The guarded number is the MEAN.

Comparison is against scripts/perf-baseline.json with a configurable
regression threshold (default +25% slower). REPORT-ONLY by default: prints a
table, emits GitHub `::warning::` annotations for regressions, and exits 0.
`--strict` flips regressions (and benches missing from the run) to exit 1 —
per docs/TEST_COVERAGE_PLAN_2026-07.md §3.5 the lane runs report-only for two
weeks first.

Baseline numbers are machine-specific: the checked-in file was generated on a
local Apple-silicon machine and WILL NOT match GitHub runners. The first CI
run should regenerate the baseline from its own outputs (pass
`--write-baseline` and promote the uploaded artifact to
scripts/perf-baseline.json) — report-only mode makes that safe.

Python 3 stdlib only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# --- duration / number parsing ------------------------------------------------

# Rust Duration debug format: 12ns / 71.2µs / 3.5ms / 1.25s. Accept both the
# micro sign (µ, U+00B5) and Greek mu (μ, U+03BC), plus plain "us".
_DURATION_UNITS_MS = {
    "ns": 1e-6,
    "us": 1e-3,
    "µs": 1e-3,
    "μs": 1e-3,
    "ms": 1.0,
    "s": 1000.0,
}
_DURATION_RE = r"([0-9]+(?:\.[0-9]+)?)\s*(ns|µs|μs|us|ms|s)"

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def _strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text)


def _duration_to_ms(value: str, unit: str) -> float:
    return float(value) * _DURATION_UNITS_MS[unit]


def _to_float(token: str) -> float:
    """Parse a vitest numeric column ('6,888.27' -> 6888.27)."""
    return float(token.replace(",", ""))


# --- backend (cseq-bench) -----------------------------------------------------

_BACKEND_STATS_RE = re.compile(
    r"^\s*min\s+" + _DURATION_RE
    + r"\s+median\s+" + _DURATION_RE
    + r"\s+mean\s+" + _DURATION_RE
    + r"\s+max\s+" + _DURATION_RE
    + r"\s+checksum\s+\d+\s*$"
)


def parse_backend(text: str) -> dict[str, float]:
    """Return {case name: median ms} from cseq-bench stdout."""
    results: dict[str, float] = {}
    last_nonblank: str | None = None
    prev_nonblank: str | None = None
    for raw in text.splitlines():
        line = _strip_ansi(raw.rstrip())
        if not line.strip():
            continue
        match = _BACKEND_STATS_RE.match(line)
        if match:
            # The stats line is preceded by the description line, which is
            # preceded by the (unindented) case name.
            name = None
            for candidate in (prev_nonblank, last_nonblank):
                if candidate and not candidate.startswith(" "):
                    name = candidate.strip()
                    break
            if name is None and prev_nonblank is not None:
                name = prev_nonblank.strip()
            if name:
                results[name] = _duration_to_ms(match.group(3), match.group(4))
        prev_nonblank, last_nonblank = last_nonblank, line
    return results


# --- frontend (vitest bench) --------------------------------------------------

# Group header, e.g. " ✓ src/perf.bench.ts > rhythm pipeline 1839ms"
_FE_GROUP_RE = re.compile(
    r"^\s*[✓✗x·]?\s*\S*perf\.bench\.\w+\s*>\s*(.+?)\s+[0-9,.]+ms\s*$"
)
# Bench row: "· name with spaces  hz min max mean p75 p99 p995 p999 ±rme% samples [tag]"
_FE_ROW_RE = re.compile(r"^\s*[·•]\s+(.*)$")
_FE_NUM = r"[0-9][0-9,]*(?:\.[0-9]+)?"


def parse_frontend(text: str) -> dict[str, float]:
    """Return {"group > case name": mean ms} from vitest bench stdout."""
    results: dict[str, float] = {}
    group = ""
    for raw in text.splitlines():
        line = _strip_ansi(raw.rstrip())
        gmatch = _FE_GROUP_RE.match(line)
        if gmatch:
            group = gmatch.group(1).strip()
            continue
        rmatch = _FE_ROW_RE.match(line)
        if not rmatch:
            continue
        body = rmatch.group(1).strip()
        tokens = body.split()
        # Drop a trailing fastest/slowest marker if present.
        if tokens and tokens[-1] in ("fastest", "slowest"):
            tokens = tokens[:-1]
        # Need name + 10 numeric columns (hz min max mean p75 p99 p995 p999
        # rme samples). rme looks like ±0.62%.
        if len(tokens) < 11:
            continue
        numeric = tokens[-10:]
        name_tokens = tokens[:-10]
        if not name_tokens:
            continue
        rme = numeric[8]
        if not (rme.startswith("±") and rme.endswith("%")):
            continue
        try:
            mean_ms = _to_float(numeric[3])
        except ValueError:
            continue
        name = " ".join(name_tokens)
        key = f"{group} > {name}" if group else name
        results[key] = mean_ms
    return results


# --- comparison ----------------------------------------------------------------


def compare(
    baseline: dict[str, float],
    current: dict[str, float],
    threshold_pct: float,
    lane: str,
):
    """Yield (lane, name, base_ms, cur_ms, delta_pct, status) rows."""
    rows = []
    for name in sorted(set(baseline) | set(current)):
        base = baseline.get(name)
        cur = current.get(name)
        if base is None:
            rows.append((lane, name, None, cur, None, "new (no baseline)"))
            continue
        if cur is None:
            rows.append((lane, name, base, None, None, "MISSING from run"))
            continue
        if base <= 0:
            rows.append((lane, name, base, cur, None, "bad baseline (<=0)"))
            continue
        delta = (cur - base) / base * 100.0
        if delta > threshold_pct:
            status = f"REGRESSION (> +{threshold_pct:g}%)"
        elif delta < -threshold_pct:
            status = "improved (consider re-baselining)"
        else:
            status = "ok"
        rows.append((lane, name, base, cur, delta, status))
    return rows


def _fmt_ms(value) -> str:
    if value is None:
        return "-"
    if value >= 100:
        return f"{value:.1f}"
    if value >= 1:
        return f"{value:.3f}"
    return f"{value:.4f}"


def _fmt_delta(delta) -> str:
    return "-" if delta is None else f"{delta:+.1f}%"


def render_table(rows) -> str:
    headers = ("lane", "benchmark", "baseline ms", "current ms", "delta", "status")
    cells = [
        (lane, name, _fmt_ms(base), _fmt_ms(cur), _fmt_delta(delta), status)
        for (lane, name, base, cur, delta, status) in rows
    ]
    widths = [
        max(len(headers[i]), *(len(row[i]) for row in cells)) if cells else len(headers[i])
        for i in range(6)
    ]
    lines = [
        "  ".join(h.ljust(widths[i]) for i, h in enumerate(headers)),
        "  ".join("-" * widths[i] for i in range(6)),
    ]
    for row in cells:
        lines.append("  ".join(row[i].ljust(widths[i]) for i in range(6)))
    return "\n".join(lines)


def render_markdown(rows, threshold_pct: float, strict: bool) -> str:
    lines = [
        "## Perf gate ({} mode, threshold +{:g}%)".format(
            "strict" if strict else "report-only", threshold_pct
        ),
        "",
        "| Lane | Benchmark | Baseline ms | Current ms | Delta | Status |",
        "| --- | --- | ---: | ---: | ---: | --- |",
    ]
    for lane, name, base, cur, delta, status in rows:
        flag = "⚠️ " if "REGRESSION" in status or "MISSING" in status else ""
        lines.append(
            f"| {lane} | {name} | {_fmt_ms(base)} | {_fmt_ms(cur)} | "
            f"{_fmt_delta(delta)} | {flag}{status} |"
        )
    lines.append("")
    lines.append(
        "_Baseline numbers are machine-specific; if this baseline was generated "
        "on a different host class, regenerate it from this run's "
        "`perf-baseline.generated.json` artifact._"
    )
    return "\n".join(lines) + "\n"


# --- main -----------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Compare cseq-bench + vitest bench outputs against "
            "scripts/perf-baseline.json. Report-only by default (always exits 0); "
            "--strict exits 1 on regressions."
        )
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        default=Path(__file__).resolve().parent / "perf-baseline.json",
        help="baseline JSON (default: scripts/perf-baseline.json)",
    )
    parser.add_argument("--backend", type=Path, help="file with scripts/bench.sh stdout")
    parser.add_argument("--frontend", type=Path, help="file with `vitest bench --run` stdout")
    parser.add_argument(
        "--threshold",
        type=float,
        default=None,
        help="regression threshold in percent (default: baseline's "
        "thresholdPercentDefault, else 25)",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="exit 1 on regressions/missing benches (default: report-only, exit 0)",
    )
    parser.add_argument(
        "--summary",
        type=Path,
        help="append a markdown table to this file (pass $GITHUB_STEP_SUMMARY in CI)",
    )
    parser.add_argument(
        "--write-baseline",
        type=Path,
        help="write a fresh baseline JSON from this run's numbers (for promoting "
        "a CI run's numbers to scripts/perf-baseline.json)",
    )
    args = parser.parse_args()

    if not args.backend and not args.frontend:
        parser.error("provide at least one of --backend / --frontend")

    try:
        baseline_doc = json.loads(args.baseline.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"::warning::perf-check: baseline {args.baseline} not found; "
              "all benches reported as new")
        baseline_doc = {}
    except json.JSONDecodeError as error:
        print(f"::warning::perf-check: baseline {args.baseline} is not valid JSON "
              f"({error}); all benches reported as new")
        baseline_doc = {}

    threshold = args.threshold
    if threshold is None:
        threshold = float(baseline_doc.get("thresholdPercentDefault", 25))

    rows = []
    current_backend: dict[str, float] = {}
    current_frontend: dict[str, float] = {}

    if args.backend:
        text = args.backend.read_text(encoding="utf-8", errors="replace")
        current_backend = parse_backend(text)
        if not current_backend:
            print(f"::warning::perf-check: no benchmark cases parsed from {args.backend}")
        rows.extend(
            compare(baseline_doc.get("backend", {}), current_backend, threshold, "backend")
        )

    if args.frontend:
        text = args.frontend.read_text(encoding="utf-8", errors="replace")
        current_frontend = parse_frontend(text)
        if not current_frontend:
            print(f"::warning::perf-check: no benchmark cases parsed from {args.frontend}")
        rows.extend(
            compare(baseline_doc.get("frontend", {}), current_frontend, threshold, "frontend")
        )

    print(render_table(rows))
    print()

    problems = [r for r in rows if "REGRESSION" in r[5] or "MISSING" in r[5]]
    for lane, name, base, cur, delta, status in problems:
        if "MISSING" in status:
            print(
                f"::warning title=Perf bench missing::{lane} {name}: present in "
                f"baseline ({_fmt_ms(base)}ms) but absent from this run"
            )
        else:
            print(
                f"::warning title=Perf regression::{lane} {name}: "
                f"{_fmt_ms(base)}ms -> {_fmt_ms(cur)}ms ({_fmt_delta(delta)}, "
                f"threshold +{threshold:g}%)"
            )

    regressions = sum(1 for r in rows if "REGRESSION" in r[5])
    missing = sum(1 for r in rows if "MISSING" in r[5])
    new = sum(1 for r in rows if r[5].startswith("new"))
    if problems:
        print(f"\nperf-check: {regressions} regression(s), {missing} missing, "
              f"{new} new at threshold +{threshold:g}%"
              + ("" if args.strict else " (report-only; exit 0)"))
    elif new == len(rows) and rows:
        print(f"\nperf-check: no baseline overlap — all {new} benches are new "
              "(regenerate/commit the baseline)")
    else:
        print(f"\nperf-check: all compared benches within +{threshold:g}% of baseline"
              + (f" ({new} new)" if new else ""))

    if args.summary:
        with args.summary.open("a", encoding="utf-8") as handle:
            handle.write(render_markdown(rows, threshold, args.strict))

    if args.write_baseline:
        doc = {
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "host": "regenerated-by-perf-check",
            "units": "milliseconds",
            "backendMetric": "median of the measured iterations (cseq-bench)",
            "frontendMetric": "mean (vitest bench)",
            "thresholdPercentDefault": threshold,
            "note": (
                "Machine-specific numbers. Promote a CI-generated copy of this "
                "file to scripts/perf-baseline.json before flipping --strict."
            ),
            "backend": {k: round(v, 4) for k, v in sorted(current_backend.items())},
            "frontend": {k: round(v, 4) for k, v in sorted(current_frontend.items())},
        }
        args.write_baseline.write_text(
            json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"perf-check: wrote fresh baseline to {args.write_baseline}")

    if args.strict and problems:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
