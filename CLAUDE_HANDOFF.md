# Claude Handoff: Afflow Phase 1

## Purpose

This document brings a Claude coding agent from zero context to the current
Afflow baseline and defines how it can contribute to Phase 1 without colliding
with other agents working in the same repository.

Read these files before making changes, in this order:

1. `AGENTS.md`
2. `TERAX.md`
3. `PROJECT.md`
4. `docs/architecture-baseline.md`
5. This handoff

`TERAX.md` contains inherited architecture and engineering invariants.
`PROJECT.md` defines the Afflow product and roadmap. Where upstream Terax names
remain in code, treat them as compatibility-sensitive internal identifiers
unless a task explicitly includes a tested migration.

## Repository State

- Repository: `https://github.com/tabagodarren-debug/terax-ai`
- Upstream base: Terax `0.8.6`, commit
  `468fd7fcc48aef4af85a2ff8c46d0c8058d17c25`
- Completed Afflow baseline: commit `266c569`
- Current completed branch: `afflow/phase-0`
- Phase 0 branch is pushed to `origin/afflow/phase-0`
- Expected Phase 1 branch: `afflow/phase-1-workstations`
- Stack: Tauri 2, Rust, React 19, TypeScript, Zustand, xterm.js,
  CodeMirror, Vitest, pnpm
- Windows development environment: Node 24, pnpm 11.9, Rust 1.98,
  Visual Studio Build Tools 2022

At the start of every task, run:

```powershell
git status --short --branch
git log -1 --oneline
```

If Git reports dubious ownership in this environment, use the command-scoped
form below rather than changing repository history:

```powershell
git -c safe.directory=C:/Users/Admin/Afflow status --short --branch
```

Do not reset, revert, overwrite, or reformat changes made by another agent.
This is a shared working directory.

## What Phase 0 Completed

Phase 0 established a buildable Afflow fork while deliberately retaining
upstream protocol identifiers that would be expensive and risky to migrate.

- Renamed the product and primary desktop package to Afflow.
- Set the frontend package name to `afflow`, version `0.1.0`.
- Set the Rust desktop package and executable to `afflow` / `afflow.exe`.
- Set the Tauri product name to `Afflow` and application identifier to
  `app.afflow.desktop`.
- Updated visible application copy, metadata, installer details, and window
  titles for Afflow.
- Disabled the inherited Terax updater path because Afflow has no signed
  release feed yet.
- Preserved Apache-2.0 licensing and added `NOTICE` attribution for Terax.
- Added the complete product plan in `PROJECT.md`.
- Added the inherited-system map and Phase 1 guidance in
  `docs/architecture-baseline.md`.
- Verified the renamed native Windows app launches.

The following internal names intentionally remain and must not be bulk-renamed:

- `terax-cli` and `terax-control-protocol`
- Rust library name `terax_lib`
- IPC event names and OSC/shell integration tokens
- keychain service and persisted store keys
- CSS hooks and compatibility-facing identifiers

Phase 0 verification completed successfully:

- Frontend type checking
- Frontend production build
- 685 frontend tests
- 303 Rust tests
- Strict Rust Clippy with warnings denied
- Native Tauri development launch on Windows

## Product Decisions Already Made

- Afflow is an executable Tauri desktop application, not a web-only product.
- V1 does not include an embedded general-purpose browser.
- Website tools will launch in a normal installed Chrome or Edge window.
- Browser profiles and website launchers are Phase 3, not Phase 1.
- A workstation is a saved production context. It is distinct from the
  existing Local/WSL execution `workspace` concept.
- Existing Terax Spaces are the foundation for Afflow workstations. Do not add
  a second store that competes for active context, tab ownership, or restore
  behavior.

## Phase 1 Scope

Phase 1 is Workstations and File Templates:

- Add a persistent workstation sidebar.
- Add create, open, rename, reorder, and archive actions.
- Add a versioned workstation schema and migrate existing Space records.
- Restore the last active workstation on startup.
- Scaffold the default folder and prompt structure.
- Save and restore workstation layout and tab state.
- Change the file explorer root when the active workstation changes.
- Preserve live terminal, editor, and preview state across switches.

Phase 1 exit criterion:

> Switching workstations changes the file tree and restores the correct layout
> without losing state.

Do not implement Phase 2 agent presets or Phase 3 browser profiles during this
phase unless the lead explicitly changes scope.

## Default Workstation Scaffold

```text
<workstation>/
|-- agents/
|   |-- script-generator/
|   |   `-- prompt.md
|   |-- script-reviewer/
|   |   `-- prompt.md
|   `-- video-prompt/
|       `-- prompt.md
|-- products/
|-- references/
|-- research/
|-- scripts/
|-- images/
|-- audio/
|-- videos/
|-- outputs/
`-- workstation.json
```

The canonical starter prompt contents are in `PROJECT.md`, section 11. Do not
invent shortened alternatives. Prompt templates are regular project files, not
secrets and not application credentials.

## Existing Architecture to Extend

Use these existing owners instead of creating parallel systems:

- `src/modules/spaces/lib/store.ts`: `SpaceMeta` persistence model.
- `src/modules/spaces/lib/useSpaces.ts`: ordered spaces, active space, actions,
  and hydration state.
- `src/modules/spaces/SpaceSwitcher.tsx`: current create, switch, rename,
  delete, reorder, tab-group, and tab-move UI.
- `src/modules/spaces/lib/serialize.ts`: persisted tab and space snapshots.
- `src/modules/spaces/lib/useSpacesBoot.ts`: startup restoration.
- `src/modules/spaces/lib/useSpacePersistence.ts`: persistence updates.
- `src/modules/tabs/lib/useTabs.ts`: tab source of truth and `spaceId`
  ownership.
- `src/modules/tabs/lib/useWorkspaceCwd.ts`: currently couples dynamic terminal
  cwd and explorer root.
- `src/app/App.tsx`: composition and cross-module coordination.
- `src/app/components/WorkspaceSurface.tsx`: keeps inactive surfaces mounted so
  live state survives switching.
- `src-tauri/src/lib.rs`: Tauri command registration.
- `src-tauri/src/modules/fs/`: native filesystem operations and validation
  patterns.
- `src-tauri/src/modules/workspace.rs`: Local/WSL execution authorization. This
  is not the Afflow workstation model.

The intended Phase 1 architecture is:

1. Evolve `SpaceMeta` into the workstation record with explicit schema
   versioning and migration.
2. Preserve stable IDs, current tab ownership, and serialized snapshots.
3. Source the explorer root from the active workstation's stable root.
4. Keep terminal cwd dynamic for shell navigation and new-terminal inheritance.
5. Switch visibility by existing `spaceId`; do not unmount or dispose inactive
   workstation sessions.
6. Archive or remove only metadata and tab state. Never delete the external
   root directory.

## Recommended Claude Assignment

Claude is best used for a bounded workstream that has minimal overlap with the
frontend persistence and sidebar agents:

### Native workstation scaffolding

After the lead confirms the frontend-to-Rust command DTO, Claude may own:

- A focused Rust workstation-scaffolding module under
  `src-tauri/src/modules/`.
- Thin Tauri command registration in `src-tauri/src/lib.rs`.
- Input and path validation at the IPC boundary.
- Idempotent creation of the directories and three canonical prompt files.
- Safe creation of `workstation.json` using structured serialization.
- Explicit behavior for an existing non-empty directory.
- Rollback or a clearly defined partial-failure policy.
- Rust unit and integration tests using temporary directories.

Required invariants:

- Never delete or replace unrelated user files.
- Never use shell command strings for filesystem operations.
- Never follow an input that escapes the selected workstation root.
- Re-running scaffolding must be safe and deterministic.
- Existing prompt files must not be silently overwritten.
- JSON must be produced with `serde`, not string concatenation.
- OS access stays in Rust; React invokes a narrow command.

Do not edit these files for that assignment unless the lead explicitly grants
ownership:

- `src/modules/spaces/**`
- `src/modules/tabs/**`
- `src/app/App.tsx`
- workstation sidebar components

### Secondary contribution

After the implementation agents finish, Claude can independently review and
test these failure cases:

- migration from the unversioned Phase 0 Space schema
- missing or moved workstation roots
- duplicate names versus stable unique IDs
- switching after a terminal navigates outside its initial root
- archive with dirty editor tabs
- archive with running terminals
- restart with a missing last-active workstation
- malformed persisted JSON
- scaffold retry after partial creation
- Windows path separators, drive letters, and case differences

Report findings first with file and line references. Do not silently refactor
unrelated code during review.

## Multi-Agent Coordination Rules

- The lead agent owns contracts, sequencing, integration, and final status.
- Claim exact files before editing. One agent owns a file at a time.
- Do not make opportunistic changes outside the assigned workstream.
- Re-read `git diff` before every edit because another agent may have changed
  the shared checkout.
- Keep commits small and limited to the assigned workstream.
- Do not amend, squash, rebase, force-push, or change branches while other
  agents are active unless the lead explicitly coordinates it.
- Do not mark Phase 1 complete independently. Return changed files, tests run,
  failures, and remaining risks to the lead.

Before beginning implementation, send the lead:

1. The proposed command name and request/response types.
2. Existing-directory and overwrite semantics.
3. The exact files Claude intends to edit.
4. The test cases Claude intends to add.

## Engineering Rules

- Use `pnpm`, never npm, npx, or yarn.
- Use `@/...` frontend imports across modules.
- Use `apply_patch` for manual edits.
- Do not add em dashes or emojis to code, comments, docs, or commit messages.
- Keep React components and Tauri commands thin. Put logic in pure,
  dependency-light functions that can be tested directly.
- Validate all filesystem and IPC inputs.
- Do not add a database, backend service, authentication system, or new heavy
  dependency for Phase 1.
- Preserve dirty-editor guards and live PTY lifecycle invariants.
- Never expose or persist secrets, cookies, tokens, or native process handles
  in `workstation.json`.

## Verification Commands

Run the focused tests during development, then the applicable full checks
before handing work back:

```powershell
pnpm lint
pnpm check-types
pnpm test
pnpm build
Set-Location src-tauri
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

Use `cargo nextest run --locked` when `cargo-nextest` is installed. A core
filesystem, persistence, tab, or PTY behavior change requires a test that locks
the invariant.

## Handoff Response Format

When returning work to the lead, provide:

```text
Assignment:
Files changed:
Behavior implemented:
Tests added:
Commands run and results:
Known limitations or risks:
Suggested integration steps:
```

