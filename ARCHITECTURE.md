# Architecture

The canonical architecture document lives at
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Short version:

- Rust owns deterministic structure, generator execution, event realization,
  transport, MIDI, and score persistence.
- Tauri owns the desktop shell and command/event bridge.
- React/TypeScript owns the visible UI, editable drafts, and patch/track disk
  projection.
- `ui/src/bridge.ts` is the only frontend module that should talk directly to
  Tauri APIs.
- `resolve_generator_cycle` is shared by stopped preview and transport.
- Timeline playback layers are recorded from the cycle-local realization that
  produced MIDI.

Related documents:

- [README.md](README.md) - user manual and feature tour.
- [docs/ADDING_A_GENERATOR.md](docs/ADDING_A_GENERATOR.md) - generator contract
  and touch-point checklist.
- [docs/SECTIONS_SUBDIVISIONS_LOGIC_SPEC.md](docs/SECTIONS_SUBDIVISIONS_LOGIC_SPEC.md)
  - fixed section and grid semantics.
- [docs/UI_AND_INTERACTION.md](docs/UI_AND_INTERACTION.md) - UI conventions.
- [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md) - high-density agent handoff.
