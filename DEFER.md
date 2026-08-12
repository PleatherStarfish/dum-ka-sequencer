# Deferred Work

This ledger recorded the extraction's out-of-scope items (the extraction was
intentionally limited to its eight sanctioned behavior changes) and now also
carries their Dum-Ka-era status. Items without a status note remain deferred.

- Decompose `App.tsx` beyond the splits required by the extraction.
- Upgrade Playwright 1.42.1, React, Tauri, or other dependencies; do not run broad Cargo updates.
- Recalibrate mutants or performance beyond the required baseline regeneration.
- Tune chaos, fuzz, or soak campaigns.
- Purge dead CSS selectors beyond feature removal.
- ~~Add generators beyond the Example generator.~~ **Superseded 2026-08-10:**
  this bound only the extraction project; the Dum-Ka charter
  ([docs/ROADMAP.md](docs/ROADMAP.md)) exists precisely to add the `dumka`
  generator through the documented seam.
- Rename `cseq-*` crates or `CAESURA_*` environment variables.
- Replace icons or other branding assets.
- Add timestamped MIDI delivery milestones.
- Backport fixes to `carnatic-seq`.
- Initialize fresh-launch project metadata so mute, solo, and rename cannot
  silently no-op before a project is applied (upstream finding 25).
- Unify the live parallel-runtime configuration gate with Track Flow and
  hidden-trigger-source topology (upstream finding 29).
- Map Track Flow's synthetic lane identity back to the active authored source
  when selecting live realized generator rows (upstream finding 30).
