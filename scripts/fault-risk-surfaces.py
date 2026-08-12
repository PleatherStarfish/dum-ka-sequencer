#!/usr/bin/env python3
"""Rank codebase surfaces by likely fault risk.

This tool is inspired by Nath and Domingos' Tractable Fault Localization Model
(TFLM): each program part has an unobserved latent subclass, a buggy indicator,
and diagnostic/static attributes; tractable inference ranks parts by
P(buggy = 1 | evidence). This implementation uses the repository tree as the
part decomposition and files as the finest-grained nodes. It is deliberately
lightweight: no training corpus or coverage instrumentation is required, but an
optional Tarantula-style spectrum JSON can be supplied when available.

The model is not a drop-in reproduction of the AAAI 2016 paper. It is a
practical, self-contained approximation for "where should I inspect first?" in
this repository:

  root -> surface -> file -> attributes

Each file is scored by a small mixture over latent risk subclasses. Surface
scores aggregate the per-file probabilities with a noisy-OR / expected-fault
mass style summary.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable


CODE_SUFFIXES = {
    ".rs",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".cjs",
    ".mjs",
    ".json",
    ".toml",
}

TEST_MARKERS = (
    ".test.",
    ".spec.",
    "/tests/",
    "/test/",
    "/fuzz/",
    "proptest-regressions",
    "__fixtures__",
    "__snapshots__",
)

BUGFIX_RE = re.compile(
    r"\b(fix|fixed|bug|regression|crash|panic|fault|fail|failure|flaky|"
    r"broken|stale|drift|desync|incorrect|wrong|repair|hotfix)\b",
    re.IGNORECASE,
)

COMPLEXITY_RE = re.compile(
    r"\b(if|else\s+if|for|while|loop|match|case|catch|switch|try|await|async)\b"
    r"|&&|\|\||\?",
)

PUBLIC_API_RE = re.compile(
    r"\b(export\s+(function|const|class|interface|type|enum)|"
    r"pub\s+(fn|struct|enum|trait|mod|type)|"
    r"#\s*\[\s*tauri::command\s*\])\b"
)

IMPORT_RE = re.compile(
    r"^\s*(import\b.*?\bfrom\s+[\"']([^\"']+)[\"']|"
    r"import\s+[\"']([^\"']+)[\"']|"
    r"const\b.*?require\([\"']([^\"']+)[\"']\)|"
    r"use\s+[^;]+;|mod\s+\w+\s*;)",
    re.MULTILINE,
)

KEYWORD_GROUPS = {
    "invariant": (
        "generator",
        "subdivision",
        "grouping",
        "gati",
        "jathi",
        "tiling",
        "section start",
        "pulse span",
        "timeline",
        "midi",
        "playback",
        "scheduler",
        "queue",
        "rational",
    ),
    "random": (
        "seed",
        "rng",
        "random",
        "probability",
        "weight",
        "markov",
        "fallback",
        "entry",
    ),
    "bridge": (
        "dto",
        "serde",
        "tauri",
        "invoke",
        "patch",
        "schema",
        "fixture",
        "bridge",
        "persist",
    ),
    "state": (
        "usestate",
        "usememo",
        "useeffect",
        "dispatch",
        "setstate",
        "props",
        "onchange",
    ),
    "time": (
        "tick",
        "tempo",
        "cycle",
        "offset",
        "duration",
        "automationtime",
        "lookahead",
        "window",
    ),
    "parser": (
        "parse",
        "parser",
        "import",
        "export",
        "json",
        "xml",
        "midi",
        "musicxml",
        "deserialize",
        "serialize",
    ),
    "matrix": (
        "matrix",
        "transition",
        "state",
        "context",
        "target",
        "sparse",
        "dense",
        "transpose",
    ),
    "concurrency": (
        "async",
        "await",
        "thread",
        "mutex",
        "arc<",
        "tokio",
        "channel",
        "atomic",
    ),
    "conflict": (
        "conflict",
        "collision",
        "suppress",
        "channel_logic",
        "channellogic",
        "priority_rank",
        "veto",
    ),
}


@dataclass
class GitStats:
    commits: int = 0
    bugfix_commits: int = 0
    authors: set[str] = field(default_factory=set)
    added: int = 0
    deleted: int = 0
    recent_commits: int = 0
    recent_added: int = 0
    recent_deleted: int = 0

    @property
    def churn(self) -> int:
        return self.added + self.deleted

    @property
    def recent_churn(self) -> int:
        return self.recent_added + self.recent_deleted


@dataclass
class FileMetrics:
    path: str
    surface: str
    suffix: str
    code_loc: int = 0
    loc: int = 0
    complexity: int = 1
    max_nesting: int = 0
    imports: int = 0
    public_api: int = 0
    fan_in: int = 0
    fan_out: int = 0
    keyword_hits: dict[str, int] = field(default_factory=dict)
    has_near_test: bool = False
    inline_tests: int = 0
    is_test: bool = False
    is_doc_or_config: bool = False
    dirty: bool = False
    untracked: bool = False
    git: GitStats = field(default_factory=GitStats)
    diagnostic: float = 0.0


@dataclass
class FileRisk:
    path: str
    surface: str
    probability: float
    confidence: float
    latent: dict[str, float]
    features: dict[str, float]
    reasons: list[str]


@dataclass
class SurfaceRisk:
    surface: str
    score: float
    expected_faults: float
    noisy_or: float
    files: int
    top_files: list[FileRisk]
    reasons: list[str]


LATENT_CLASSES: dict[str, dict[str, Any]] = {
    "semantic_core": {
        "context_bias": 0.25,
        "context": {
            "invariant": 1.8,
            "time": 0.9,
            "random": 0.7,
            "surface_core": 1.0,
            "test_file": -1.4,
        },
        "bug_bias": -3.15,
        "bug": {
            "complexity_density": 1.2,
            "size": 0.55,
            "invariant": 1.25,
            "time": 0.85,
            "random": 0.75,
            "recent_churn": 0.8,
            "test_gap": 0.65,
            "bugfix_history": 1.15,
            "diagnostic": 1.6,
        },
    },
    "boundary_bridge": {
        "context_bias": -0.05,
        "context": {
            "bridge": 1.6,
            "parser": 0.9,
            "surface_bridge": 1.1,
            "public_api": 0.55,
            "test_file": -1.2,
        },
        "bug_bias": -3.25,
        "bug": {
            "bridge": 1.2,
            "parser": 0.85,
            "public_api": 0.7,
            "fan_in": 0.6,
            "churn": 0.75,
            "bugfix_history": 1.0,
            "test_gap": 0.75,
            "diagnostic": 1.7,
        },
    },
    "volatile_ui_state": {
        "context_bias": 0.0,
        "context": {
            "state": 1.8,
            "matrix": 0.55,
            "surface_ui": 1.0,
            "test_file": -1.2,
        },
        "bug_bias": -3.35,
        "bug": {
            "state": 1.05,
            "complexity_density": 0.85,
            "size": 0.75,
            "recent_churn": 0.95,
            "authors": 0.55,
            "test_gap": 0.7,
            "diagnostic": 1.35,
        },
    },
    "matrix_probability": {
        "context_bias": -0.2,
        "context": {
            "matrix": 1.5,
            "random": 1.1,
            "surface_probability": 0.8,
            "test_file": -1.1,
        },
        "bug_bias": -3.45,
        "bug": {
            "matrix": 1.2,
            "random": 1.0,
            "complexity_density": 0.75,
            "bugfix_history": 0.8,
            "test_gap": 0.6,
            "diagnostic": 1.45,
        },
    },
    "test_or_spec": {
        "context_bias": -0.7,
        "context": {
            "test_file": 2.2,
            "surface_test": 0.9,
        },
        "bug_bias": -4.2,
        "bug": {
            "size": 0.45,
            "complexity_density": 0.45,
            "recent_churn": 0.55,
            "bugfix_history": 0.65,
            "diagnostic": 0.9,
        },
    },
}


CORE_SURFACES = {
    "transport_scheduler_playback",
    "generator_sections_tiling",
    "triggered_tracks",
}

BRIDGE_SURFACES = {
    "tauri_bridge_persistence",
    "dto_patch_contracts",
    "legacy_persistence_compatibility",
}

UI_SURFACES = {
    "generator_ui_state",
    "channel_hocket_ui",
    "track_flow_trigger_ui",
    "timeline_ui_parity",
    "automation_ui_state",
    "general_ui_state",
}

PROBABILITY_SURFACES = {
    "generator_sections_tiling",
    "generator_ui_state",
    "channel_hocket_ui",
    "track_flow_trigger_ui",
}

TEST_SURFACES = {
    "tests_fuzz_harness",
    "docs_specs",
}


def run(cmd: list[str], cwd: Path, allow_fail: bool = False) -> str:
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=not allow_fail,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        if allow_fail:
            return ""
        raise
    if proc.returncode != 0 and allow_fail:
        return ""
    return proc.stdout


def is_test_path(path: str) -> bool:
    lowered = "/" + path.lower()
    return any(marker in lowered for marker in TEST_MARKERS)


def should_include(path: str, include_tests: bool) -> bool:
    p = Path(path)
    if p.suffix not in CODE_SUFFIXES:
        return False
    lowered = path.lower()
    if any(part in lowered for part in ("/node_modules/", "/target/", "/dist/")):
        return False
    if lowered.startswith("docs/manual/caesura-user-manual."):
        return False
    if is_test_path(path) and not include_tests:
        # Tests still influence test-gap detection; they are excluded from the
        # default ranked production-risk list to keep surfaces action-oriented.
        return False
    return True


def list_repo_files(repo: Path, include_tests: bool, tracked_only: bool) -> tuple[list[str], set[str]]:
    tracked = run(["git", "ls-files"], repo, allow_fail=True).splitlines()
    untracked: list[str] = []
    if not tracked_only:
        untracked = run(
            ["git", "ls-files", "--others", "--exclude-standard"],
            repo,
            allow_fail=True,
        ).splitlines()
    all_files = tracked + untracked
    untracked_set = set(untracked)
    included = [path for path in all_files if should_include(path, include_tests)]
    return sorted(set(included)), untracked_set


def dirty_files(repo: Path) -> set[str]:
    out = run(["git", "status", "--porcelain=v1"], repo, allow_fail=True)
    dirty: set[str] = set()
    for line in out.splitlines():
        if not line:
            continue
        raw = line[3:]
        if " -> " in raw:
            raw = raw.split(" -> ", 1)[1]
        dirty.add(raw.strip())
    return dirty


def parse_git_history(repo: Path, since_days: int) -> dict[str, GitStats]:
    out = run(
        [
            "git",
            "log",
            "--numstat",
            "--date=unix",
            "--format=COMMIT\t%H\t%an\t%ad\t%s",
            "--",
            ".",
        ],
        repo,
        allow_fail=True,
    )
    stats: dict[str, GitStats] = defaultdict(GitStats)
    current_subject = ""
    current_author = ""
    current_time = 0
    now = 0

    for line in out.splitlines():
        if line.startswith("COMMIT\t"):
            parts = line.split("\t", 4)
            current_author = parts[2] if len(parts) > 2 else ""
            try:
                current_time = int(parts[3]) if len(parts) > 3 else 0
            except ValueError:
                current_time = 0
            if current_time > now:
                now = current_time
            current_subject = parts[4] if len(parts) > 4 else ""
            continue
        if not line or "\t" not in line:
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        added_raw, deleted_raw, path = parts[0], parts[1], parts[2]
        if added_raw == "-" or deleted_raw == "-":
            continue
        try:
            added = int(added_raw)
            deleted = int(deleted_raw)
        except ValueError:
            continue
        st = stats[path]
        st.commits += 1
        if BUGFIX_RE.search(current_subject):
            st.bugfix_commits += 1
        if current_author:
            st.authors.add(current_author)
        st.added += added
        st.deleted += deleted

    if now:
        recent_cutoff = now - since_days * 24 * 60 * 60
        current_subject = ""
        current_author = ""
        current_time = 0
        for line in out.splitlines():
            if line.startswith("COMMIT\t"):
                parts = line.split("\t", 4)
                try:
                    current_time = int(parts[3]) if len(parts) > 3 else 0
                except ValueError:
                    current_time = 0
                current_subject = parts[4] if len(parts) > 4 else ""
                current_author = parts[2] if len(parts) > 2 else ""
                continue
            if current_time < recent_cutoff or not line or "\t" not in line:
                continue
            parts = line.split("\t")
            if len(parts) < 3 or parts[0] == "-" or parts[1] == "-":
                continue
            try:
                added = int(parts[0])
                deleted = int(parts[1])
            except ValueError:
                continue
            st = stats[parts[2]]
            st.recent_commits += 1
            st.recent_added += added
            st.recent_deleted += deleted
            if current_author:
                st.authors.add(current_author)
            if BUGFIX_RE.search(current_subject):
                st.bugfix_commits = max(st.bugfix_commits, 1)

    return stats


def classify_surface(path: str) -> str:
    p = path.lower()
    name = Path(path).name.lower()
    if p.startswith("crates/cseq-transport/"):
        return "transport_scheduler_playback"
    if p.startswith("crates/cseq-transforms/") or p.startswith("crates/cseq-rhythm/"):
        return "generator_sections_tiling"
    if p.startswith("crates/cseq-trigger/"):
        return "triggered_tracks"
    if p.startswith("crates/cseq-persist/") or p.startswith("src-tauri/"):
        return "tauri_bridge_persistence"
    if p.startswith("crates/cseq-realize/") or p.startswith("crates/cseq-midi/"):
        return "midi_realization_io"
    if p.startswith("fuzz/") or "/tests/" in p or name.endswith(".test.ts") or name.endswith(".test.tsx"):
        return "tests_fuzz_harness"
    if p.startswith("docs/"):
        return "docs_specs"
    if name in {
        "bridge.ts",
        "playbackrequests.ts",
        "patchio.ts",
        "dtocontract.test.ts",
        "dtocontract.generate.test.ts",
    }:
        return "dto_patch_contracts"
    if "timeline" in name or "playbacklayers" in name:
        return "timeline_ui_parity"
    if "generator" in name or "sectionboundar" in name or "fixedsection" in name:
        return "generator_ui_state"
    if "trackflow" in name or "trigger" in name:
        return "track_flow_trigger_ui"
    if "channel" in name or "hocket" in name:
        return "channel_hocket_ui"
    if "automation" in name:
        return "automation_ui_state"
    if "legacyrandomize" in name:
        return "legacy_persistence_compatibility"
    if p.startswith("ui/src/components/") or p.startswith("ui/src/app"):
        return "general_ui_state"
    if p.startswith("crates/"):
        return "rust_core_misc"
    if p.startswith("ui/src/"):
        return "ui_domain_misc"
    return "repo_infrastructure"


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def count_code_lines(text: str, suffix: str) -> tuple[int, int]:
    loc = 0
    code = 0
    in_block = False
    for line in text.splitlines():
        loc += 1
        stripped = line.strip()
        if not stripped:
            continue
        if suffix in {".rs", ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs"}:
            if stripped.startswith("/*"):
                in_block = True
            if in_block:
                if "*/" in stripped:
                    in_block = False
                continue
            if stripped.startswith("//") or stripped.startswith("*"):
                continue
        elif suffix in {".toml"} and stripped.startswith("#"):
            continue
        code += 1
    return loc, code


def max_brace_nesting(text: str) -> int:
    depth = 0
    max_depth = 0
    for ch in text:
        if ch == "{":
            depth += 1
            max_depth = max(max_depth, depth)
        elif ch == "}":
            depth = max(0, depth - 1)
    return max_depth


def keyword_hits(text: str) -> dict[str, int]:
    lowered = text.lower()
    return {
        group: sum(lowered.count(keyword) for keyword in keywords)
        for group, keywords in KEYWORD_GROUPS.items()
    }


def module_candidates_for_import(path: str, spec: str) -> Iterable[str]:
    if not spec.startswith("."):
        return []
    base = Path(path).parent / spec
    candidates: list[str] = []
    for suffix in (".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs"):
        candidates.append(str(base.with_suffix(suffix)).replace(os.sep, "/"))
    for index in ("index.ts", "index.tsx", "index.js", "index.jsx"):
        candidates.append(str(base / index).replace(os.sep, "/"))
    return candidates


def import_edges(path: str, text: str, known_files: set[str]) -> set[str]:
    edges: set[str] = set()
    for match in IMPORT_RE.finditer(text):
        spec = next((g for g in match.groups()[1:] if g), "")
        if spec:
            for candidate in module_candidates_for_import(path, spec):
                if candidate in known_files:
                    edges.add(candidate)
                    break
    return edges


def rust_mod_edges(path: str, text: str, known_files: set[str]) -> set[str]:
    edges: set[str] = set()
    parent = Path(path).parent
    for mod_name in re.findall(r"^\s*mod\s+([a-zA-Z_]\w*)\s*;", text, re.MULTILINE):
        for candidate in (
            parent / f"{mod_name}.rs",
            parent / mod_name / "mod.rs",
        ):
            candidate_str = str(candidate).replace(os.sep, "/")
            if candidate_str in known_files:
                edges.add(candidate_str)
    return edges


def has_near_test(path: str, all_files: set[str], text: str) -> tuple[bool, int]:
    p = Path(path)
    stem = p.stem
    suffix = p.suffix
    candidates = {
        str(p.with_name(f"{stem}.test{suffix}")).replace(os.sep, "/"),
        str(p.with_name(f"{stem}.spec{suffix}")).replace(os.sep, "/"),
        str(p.with_name(f"{stem}.test.ts")).replace(os.sep, "/"),
        str(p.with_name(f"{stem}.test.tsx")).replace(os.sep, "/"),
        str(p.with_name(f"{stem}.spec.ts")).replace(os.sep, "/"),
        str(p.with_name(f"{stem}.spec.tsx")).replace(os.sep, "/"),
    }
    inline = len(re.findall(r"#\s*\[\s*test\s*\]|describe\(|it\(|test\(", text))
    if any(candidate in all_files for candidate in candidates):
        return True, inline
    if inline > 0:
        return True, inline
    if path.startswith("crates/"):
        crate = "/".join(path.split("/")[:2])
        if any(f.startswith(f"{crate}/tests/") for f in all_files):
            return True, inline
    return False, inline


def load_diagnostics(path: str | None, repo: Path) -> dict[str, float]:
    if not path:
        return {}
    raw = json.loads(read_text((repo / path).resolve() if not os.path.isabs(path) else Path(path)))
    if not isinstance(raw, dict):
        raise ValueError("diagnostic JSON must be an object")

    if "components" in raw:
        total_failed = max(float(raw.get("total_failed", 0) or 0), 0.0)
        total_passed = max(float(raw.get("total_passed", 0) or 0), 0.0)
        result: dict[str, float] = {}
        for comp, values in raw.get("components", {}).items():
            failed = float(values.get("failed", 0) or 0)
            passed = float(values.get("passed", 0) or 0)
            if total_failed <= 0:
                score = 0.0
            else:
                f = failed / total_failed
                p = passed / total_passed if total_passed > 0 else 0.0
                score = f / (f + p) if f + p > 0 else 0.0
            result[comp] = clamp01(score)
        return result

    result = {}
    for comp, value in raw.items():
        if isinstance(value, dict):
            value = value.get("score", value.get("diagnostic", 0))
        result[comp] = clamp01(float(value or 0))
    return result


def collect_metrics(
    repo: Path,
    files: list[str],
    untracked: set[str],
    dirty: set[str],
    history: dict[str, GitStats],
    diagnostics: dict[str, float],
) -> list[FileMetrics]:
    all_known = set(files)
    all_tracked_and_untracked = set(run(["git", "ls-files"], repo, allow_fail=True).splitlines())
    all_tracked_and_untracked |= set(
        run(["git", "ls-files", "--others", "--exclude-standard"], repo, allow_fail=True).splitlines()
    )

    raw_text: dict[str, str] = {}
    metrics: dict[str, FileMetrics] = {}
    fan_out: dict[str, set[str]] = {}
    fan_in_counter: Counter[str] = Counter()

    for path in files:
        abs_path = repo / path
        text = read_text(abs_path)
        raw_text[path] = text
        suffix = abs_path.suffix
        loc, code_loc = count_code_lines(text, suffix)
        imports = len(IMPORT_RE.findall(text))
        public_api = len(PUBLIC_API_RE.findall(text))
        near_test, inline = has_near_test(path, all_tracked_and_untracked, text)
        test_file = is_test_path(path)
        surface = classify_surface(path)
        fm = FileMetrics(
            path=path,
            surface=surface,
            suffix=suffix,
            loc=loc,
            code_loc=code_loc,
            complexity=1 + len(COMPLEXITY_RE.findall(text)),
            max_nesting=max_brace_nesting(text),
            imports=imports,
            public_api=public_api,
            keyword_hits=keyword_hits(text),
            has_near_test=near_test,
            inline_tests=inline,
            is_test=test_file,
            is_doc_or_config=suffix in {".json", ".toml"} or surface == "docs_specs",
            dirty=path in dirty,
            untracked=path in untracked,
            git=history.get(path, GitStats()),
            diagnostic=clamp01(diagnostics.get(path, 0.0)),
        )
        metrics[path] = fm

    for path, text in raw_text.items():
        edges = set()
        edges |= import_edges(path, text, all_known)
        if path.endswith(".rs"):
            edges |= rust_mod_edges(path, text, all_known)
        fan_out[path] = edges
        for target in edges:
            fan_in_counter[target] += 1

    for path, fm in metrics.items():
        fm.fan_out = len(fan_out[path])
        fm.fan_in = fan_in_counter[path]

    return list(metrics.values())


def clamp01(value: float) -> float:
    return min(1.0, max(0.0, value))


def sigmoid(value: float) -> float:
    if value >= 0:
        z = math.exp(-value)
        return 1.0 / (1.0 + z)
    z = math.exp(value)
    return z / (1.0 + z)


def softmax(logits: dict[str, float]) -> dict[str, float]:
    max_logit = max(logits.values())
    exps = {key: math.exp(value - max_logit) for key, value in logits.items()}
    total = sum(exps.values()) or 1.0
    return {key: value / total for key, value in exps.items()}


def normalized_features(metrics: list[FileMetrics]) -> dict[str, dict[str, float]]:
    max_churn = max((m.git.churn for m in metrics), default=1) or 1
    max_recent = max((m.git.recent_churn for m in metrics), default=1) or 1
    max_fan_in = max((m.fan_in for m in metrics), default=1) or 1
    max_fan_out = max((m.fan_out for m in metrics), default=1) or 1
    max_authors = max((len(m.git.authors) for m in metrics), default=1) or 1
    max_commits = max((m.git.commits for m in metrics), default=1) or 1

    result: dict[str, dict[str, float]] = {}
    for m in metrics:
        code = max(m.code_loc, 1)
        bugfix_ratio = m.git.bugfix_commits / max(m.git.commits, 1)
        test_gap = 0.0 if m.is_test or m.has_near_test else 1.0
        if m.is_doc_or_config:
            test_gap *= 0.25
        features = {
            "size": clamp01(math.log1p(m.code_loc) / math.log1p(2200)),
            "complexity_density": clamp01((m.complexity / code) * 18.0),
            "nesting": clamp01(m.max_nesting / 10.0),
            "public_api": clamp01(math.log1p(m.public_api) / math.log1p(35)),
            "imports": clamp01(math.log1p(m.imports) / math.log1p(45)),
            "fan_in": clamp01(math.log1p(m.fan_in) / math.log1p(max_fan_in)),
            "fan_out": clamp01(math.log1p(m.fan_out) / math.log1p(max_fan_out)),
            "churn": clamp01(math.log1p(m.git.churn) / math.log1p(max_churn)),
            "recent_churn": clamp01(math.log1p(m.git.recent_churn) / math.log1p(max_recent)),
            "commits": clamp01(math.log1p(m.git.commits) / math.log1p(max_commits)),
            "authors": clamp01(math.log1p(len(m.git.authors)) / math.log1p(max_authors)),
            "bugfix_history": clamp01(0.65 * bugfix_ratio + 0.35 * math.log1p(m.git.bugfix_commits) / math.log1p(8)),
            "test_gap": clamp01(test_gap),
            "test_file": 1.0 if m.is_test else 0.0,
            "dirty": 1.0 if m.dirty else 0.0,
            "untracked": 1.0 if m.untracked else 0.0,
            "diagnostic": clamp01(m.diagnostic),
            "surface_core": 1.0 if m.surface in CORE_SURFACES else 0.0,
            "surface_bridge": 1.0 if m.surface in BRIDGE_SURFACES else 0.0,
            "surface_ui": 1.0 if m.surface in UI_SURFACES else 0.0,
            "surface_probability": 1.0 if m.surface in PROBABILITY_SURFACES else 0.0,
            "surface_test": 1.0 if m.surface in TEST_SURFACES else 0.0,
        }
        for group, hits in m.keyword_hits.items():
            features[group] = clamp01(math.log1p(hits) / math.log1p(50))
        result[m.path] = features
    return result


def score_file(m: FileMetrics, f: dict[str, float]) -> FileRisk:
    context_logits: dict[str, float] = {}
    for cls, params in LATENT_CLASSES.items():
        value = float(params["context_bias"])
        for feature, weight in params["context"].items():
            value += float(weight) * f.get(feature, 0.0)
        context_logits[cls] = value
    latent = softmax(context_logits)

    probability = 0.0
    for cls, posterior in latent.items():
        params = LATENT_CLASSES[cls]
        logit = float(params["bug_bias"])
        for feature, weight in params["bug"].items():
            logit += float(weight) * f.get(feature, 0.0)
        # Dirty/untracked files get a mild generic boost because the model is
        # being asked about the current worktree, not just committed history.
        logit += 0.45 * f.get("dirty", 0.0) + 0.25 * f.get("untracked", 0.0)
        probability += posterior * sigmoid(logit)

    # Config/test files can be buggy, but they should not dominate production
    # surface ranking without strong diagnostic or history evidence.
    if m.is_doc_or_config:
        probability *= 0.65 + 0.35 * max(f.get("diagnostic", 0.0), f.get("bugfix_history", 0.0))

    history_evidence = max(f.get("commits", 0.0), f.get("churn", 0.0))
    structure_evidence = max(f.get("size", 0.0), f.get("public_api", 0.0), f.get("fan_in", 0.0))
    confidence = clamp01(
        0.25
        + 0.30 * history_evidence
        + 0.25 * structure_evidence
        + 0.10 * (1.0 - f.get("untracked", 0.0))
        + 0.10 * max(f.get("diagnostic", 0.0), f.get("bugfix_history", 0.0))
    )

    reasons = explain_reasons(m, f, latent)
    return FileRisk(
        path=m.path,
        surface=m.surface,
        probability=clamp01(probability),
        confidence=confidence,
        latent=latent,
        features=f,
        reasons=reasons,
    )


def explain_reasons(m: FileMetrics, f: dict[str, float], latent: dict[str, float]) -> list[str]:
    reason_candidates: list[tuple[float, str]] = []
    feature_labels = {
        "diagnostic": "diagnostic/Tarantula evidence",
        "bugfix_history": "bugfix history",
        "recent_churn": "recent churn",
        "churn": "historical churn",
        "complexity_density": "branch/async complexity density",
        "size": "large implementation surface",
        "test_gap": "weak nearby test signal",
        "fan_in": "high fan-in",
        "fan_out": "high fan-out",
        "invariant": "project invariant keywords",
        "bridge": "bridge/serialization boundary",
        "state": "React state/effect surface",
        "time": "timing/scheduler vocabulary",
        "random": "seed/probability vocabulary",
        "parser": "parser/import/export vocabulary",
        "matrix": "matrix/Markov vocabulary",
        "conflict": "channel-conflict/collision vocabulary",
        "dirty": "currently modified",
        "untracked": "untracked new surface",
    }
    for feature, label in feature_labels.items():
        value = f.get(feature, 0.0)
        if value >= 0.28:
            reason_candidates.append((value, label))
    top_latent, top_latent_value = max(latent.items(), key=lambda kv: kv[1])
    reason_candidates.append((top_latent_value, f"latent class: {top_latent}"))
    if m.has_near_test:
        reason_candidates.append((0.26, "nearby/inline test exists"))
    if m.is_test:
        reason_candidates.append((0.25, "test/spec file"))
    reason_candidates.sort(reverse=True)
    return [label for _, label in reason_candidates[:5]]


def aggregate_surfaces(file_risks: list[FileRisk]) -> list[SurfaceRisk]:
    grouped: dict[str, list[FileRisk]] = defaultdict(list)
    for risk in file_risks:
        grouped[risk.surface].append(risk)

    surfaces: list[SurfaceRisk] = []
    for surface, risks in grouped.items():
        ordered = sorted(risks, key=lambda r: r.probability, reverse=True)
        expected = sum(r.probability for r in risks)
        noisy_or = 1.0
        for r in risks:
            noisy_or *= 1.0 - min(0.95, r.probability)
        noisy_or = 1.0 - noisy_or
        top = ordered[: min(5, len(ordered))]
        top_mean = sum(r.probability for r in top) / max(len(top), 1)
        max_risk = ordered[0].probability if ordered else 0.0
        score = clamp01(0.48 * max_risk + 0.34 * top_mean + 0.18 * (1.0 - math.exp(-expected / 3.0)))
        reasons = surface_reasons(top)
        surfaces.append(
            SurfaceRisk(
                surface=surface,
                score=score,
                expected_faults=expected,
                noisy_or=noisy_or,
                files=len(risks),
                top_files=top,
                reasons=reasons,
            )
        )
    return sorted(surfaces, key=lambda s: s.score, reverse=True)


def surface_reasons(top_files: list[FileRisk]) -> list[str]:
    counts: Counter[str] = Counter()
    for risk in top_files:
        for reason in risk.reasons[:3]:
            counts[reason] += 1
    return [reason for reason, _ in counts.most_common(4)]


def build_report(
    repo: Path,
    include_tests: bool,
    tracked_only: bool,
    since_days: int,
    diagnostic_json: str | None,
) -> tuple[list[SurfaceRisk], list[FileRisk], dict[str, Any]]:
    files, untracked = list_repo_files(repo, include_tests=include_tests, tracked_only=tracked_only)
    dirty = dirty_files(repo)
    history = parse_git_history(repo, since_days=since_days)
    diagnostics = load_diagnostics(diagnostic_json, repo)
    metrics = collect_metrics(repo, files, untracked, dirty, history, diagnostics)
    features = normalized_features(metrics)
    file_risks = [score_file(m, features[m.path]) for m in metrics if m.code_loc > 0]
    file_risks.sort(key=lambda r: r.probability, reverse=True)
    surfaces = aggregate_surfaces(file_risks)
    meta = {
        "repo": str(repo),
        "files_scored": len(file_risks),
        "include_tests": include_tests,
        "tracked_only": tracked_only,
        "since_days": since_days,
        "diagnostic_json": diagnostic_json,
    }
    return surfaces, file_risks, meta


def pct(value: float) -> str:
    return f"{value * 100:5.1f}%"


def fmt_number(value: float) -> str:
    return f"{value:.2f}"


def render_markdown(
    surfaces: list[SurfaceRisk],
    files: list[FileRisk],
    meta: dict[str, Any],
    surface_top: int,
    file_top: int,
) -> str:
    lines: list[str] = []
    lines.append("# Fault Risk Surface Report")
    lines.append("")
    lines.append(
        "Model: TFLM-inspired latent-class mixture over repository file nodes; "
        "surface scores aggregate file probabilities."
    )
    lines.append(
        f"Inputs: {meta['files_scored']} files, include_tests={meta['include_tests']}, "
        f"tracked_only={meta['tracked_only']}, recent_window={meta['since_days']} days."
    )
    if meta.get("diagnostic_json"):
        lines.append(f"Diagnostic feature: `{meta['diagnostic_json']}`.")
    else:
        lines.append("Diagnostic feature: none supplied; history/static evidence only.")
    lines.append("")
    lines.append("## Top Surfaces")
    lines.append("")
    lines.append("| Rank | Surface | Score | Expected faults | Noisy-OR | Files | Main signals |")
    lines.append("| ---: | --- | ---: | ---: | ---: | ---: | --- |")
    for idx, surface in enumerate(surfaces[:surface_top], 1):
        lines.append(
            f"| {idx} | `{surface.surface}` | {pct(surface.score)} | "
            f"{fmt_number(surface.expected_faults)} | {pct(surface.noisy_or)} | "
            f"{surface.files} | {', '.join(surface.reasons)} |"
        )
    lines.append("")
    lines.append("## Top Files")
    lines.append("")
    lines.append("| Rank | Risk | Conf. | Surface | File | Why |")
    lines.append("| ---: | ---: | ---: | --- | --- | --- |")
    for idx, risk in enumerate(files[:file_top], 1):
        lines.append(
            f"| {idx} | {pct(risk.probability)} | {pct(risk.confidence)} | "
            f"`{risk.surface}` | `{risk.path}` | {', '.join(risk.reasons)} |"
        )
    lines.append("")
    lines.append("## Notes")
    lines.append("")
    lines.append(
        "- Treat these as inspection priors, not proof. They are designed to focus "
        "review, fuzzing, and regression-test effort."
    )
    lines.append(
        "- Supplying failing/passing coverage spectra makes the diagnostic term act "
        "like the Tarantula feature used by the TFLM paper."
    )
    lines.append(
        "- High-risk files with low confidence usually need more history, tests, or "
        "runtime evidence before the ranking should be trusted strongly."
    )
    return "\n".join(lines)


def render_json(
    surfaces: list[SurfaceRisk],
    files: list[FileRisk],
    meta: dict[str, Any],
    surface_top: int,
    file_top: int,
) -> str:
    payload = {
        "meta": meta,
        "surfaces": [
            {
                "surface": s.surface,
                "score": s.score,
                "expected_faults": s.expected_faults,
                "noisy_or": s.noisy_or,
                "files": s.files,
                "reasons": s.reasons,
                "top_files": [r.path for r in s.top_files],
            }
            for s in surfaces[:surface_top]
        ],
        "files": [
            {
                "path": r.path,
                "surface": r.surface,
                "probability": r.probability,
                "confidence": r.confidence,
                "latent": r.latent,
                "features": r.features,
                "reasons": r.reasons,
            }
            for r in files[:file_top]
        ],
    }
    return json.dumps(payload, indent=2, sort_keys=True)


def run_self_test() -> None:
    assert abs(sigmoid(0.0) - 0.5) < 1e-9
    sm = softmax({"a": 0.0, "b": 0.0})
    assert abs(sum(sm.values()) - 1.0) < 1e-9
    assert (
        classify_surface("crates/cseq-rhythm/src/generators/example.rs")
        == "generator_sections_tiling"
    )
    assert classify_surface("ui/src/components/GeneratorEditor.tsx") == "generator_ui_state"
    assert classify_surface("ui/src/trackFlowBoxes.ts") == "track_flow_trigger_ui"
    assert (
        classify_surface("ui/src/legacyRandomizeSettings.ts")
        == "legacy_persistence_compatibility"
    )
    spectra_path = Path("/tmp/fault-risk-spectra-test.json")
    spectra_path.write_text(
        json.dumps(
            {
                "total_failed": 4,
                "total_passed": 6,
                "components": {
                    "a.rs": {"failed": 4, "passed": 0},
                    "b.rs": {"failed": 1, "passed": 6},
                },
            }
        ),
        encoding="utf-8",
    )
    diagnostics = load_diagnostics(str(spectra_path), Path.cwd())
    assert diagnostics["a.rs"] > diagnostics["b.rs"]

    high = FileMetrics(
        path="crates/cseq-transport/src/lib.rs",
        surface="transport_scheduler_playback",
        suffix=".rs",
        code_loc=1400,
        complexity=120,
        keyword_hits={key: 40 for key in KEYWORD_GROUPS},
        has_near_test=False,
        git=GitStats(commits=20, bugfix_commits=6, added=5000, deleted=3500),
        diagnostic=0.75,
    )
    low = FileMetrics(
        path="ui/src/themePrefs.ts",
        surface="ui_domain_misc",
        suffix=".ts",
        code_loc=40,
        complexity=2,
        keyword_hits={key: 0 for key in KEYWORD_GROUPS},
        has_near_test=True,
        git=GitStats(commits=2, bugfix_commits=0, added=50, deleted=5),
    )
    feats = normalized_features([high, low])
    high_risk = score_file(high, feats[high.path])
    low_risk = score_file(low, feats[low.path])
    assert high_risk.probability > low_risk.probability
    spectra_path.unlink(missing_ok=True)
    print("self-test passed")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rank fault-risk surfaces using a TFLM-inspired repository model."
    )
    parser.add_argument(
        "--repo",
        default=".",
        help="Repository root to analyze (default: current directory).",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=25,
        help="Number of file rows to print (default: 25).",
    )
    parser.add_argument(
        "--surface-top",
        type=int,
        default=12,
        help="Number of surface rows to print (default: 12).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit full JSON instead of Markdown.",
    )
    parser.add_argument(
        "--include-tests",
        action="store_true",
        help="Include tests/fuzz/spec files in the ranked output.",
    )
    parser.add_argument(
        "--tracked-only",
        action="store_true",
        help="Ignore untracked worktree files.",
    )
    parser.add_argument(
        "--since-days",
        type=int,
        default=90,
        help="Recent churn window in days (default: 90).",
    )
    parser.add_argument(
        "--diagnostic-json",
        help=(
            "Optional JSON feature. Either {file: score} or "
            "{total_failed,total_passed,components:{file:{failed,passed}}}."
        ),
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run built-in sanity tests and exit.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if args.self_test:
        run_self_test()
        return 0
    repo = Path(args.repo).resolve()
    surfaces, files, meta = build_report(
        repo=repo,
        include_tests=args.include_tests,
        tracked_only=args.tracked_only,
        since_days=args.since_days,
        diagnostic_json=args.diagnostic_json,
    )
    if args.json:
        print(render_json(surfaces, files, meta, args.surface_top, args.top))
    else:
        print(render_markdown(surfaces, files, meta, args.surface_top, args.top))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
