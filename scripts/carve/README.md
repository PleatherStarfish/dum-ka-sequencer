# App.tsx carve-up tooling

Support scripts for the incremental App.tsx decomposition (see
docs/AI_HANDOFF.md "Main UI"). The pattern, per panel:

1. **Snapshot first**: `cp ui/src/App.tsx /tmp/App.backup.<round>.tsx`.
2. Find the panel's `<details>`/`</details>` bounds (assert both lines before
   cutting — a wrong bound once swallowed the whole App body).
3. `python3 scripts/carve/propgen.py <start> <end>` (run from `ui/`) prints a
   draft props interface: every App-scope binding the block uses, with types
   extracted from `useState` generics/initializers and annotated consts.
   `UNKNOWN /* derived */` entries need a manual lookup of the declaration.
4. Create the component with the JSX body **unchanged** (props keep the
   original names, destructured), call site passes `name={name}` per prop.
5. Gates per round: `pnpm typecheck`, then the boot check —
   `pnpm exec playwright test --config playwright.bootcheck.config.ts
   main-editor-launcher --workers=1` — typecheck alone cannot prove the app
   boots. Finish with the panel's own e2e spec if one exists.

Extracted so far: MidiDebugPanel, AutomationDebugPanel, ScoreSetupPanel,
ChannelShaperPanel. Remaining (descending size): rhythm-shaper (~4.3k lines,
plan a full session), pitch-shaper (~1.4k, 111 bindings — propgen draft
resolves ~70 automatically), section-boundaries (~380), Setup/Seed/Synth
dialogs.
