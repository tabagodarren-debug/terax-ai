# Claude Handoff: Afflow Phase 2

## Purpose

This document gives Claude the exact context, ownership boundary, contracts,
and verification requirements for Afflow Phase 2. The checkout is shared with
Codex agents. Do not edit outside the assigned files and do not commit.

## Repository State

- Repository: `C:\Users\Admin\Afflow`
- Phase 2 branch: `afflow/phase-2-agent-presets`
- Phase 1 implementation commit: `82c2fa9`
- Phase 1 handoff commit: `5b27093`
- Phase 0 baseline commit: `266c569`
- Package manager: pnpm only
- Frontend: React 19 and TypeScript
- Native app: Tauri 2 and Rust
- Current Phase 1 state: workstations are implemented, verified, committed,
  and pushed.
- Shared checkout rule: other agents may modify unrelated files while Claude
  works. Do not revert, reformat, stage, commit, or clean their changes.

Read these files before editing:

1. `AGENTS.md`
2. `TERAX.md`
3. `PROJECT.md`, especially sections 8.4, 8.5, 9, 10, 11, and Phase 2
4. This file

## Phase 2 Product Scope

Phase 2 is Agent Presets:

- Add four workstation workflow roles:
  - General Agent
  - Script Generator
  - Script Reviewer
  - Image-to-Video Prompt Generator
- Keep workflow roles separate from CLI brands.
- Allow a role to use Claude Code, Codex CLI, Gemini CLI, OpenCode, or a
  validated custom command.
- Start every role terminal at the active workstation root.
- Expose the three scaffolded `prompt.md` files.
- Provide a one-click Copy startup instruction action instead of fragile
  automatic prompt injection.
- Allow secure one-click opening of referenced output files.

Phase 2 exit criterion:

> All four presets launch successfully using at least one installed CLI.

## Frozen Architecture Decisions

These decisions are approved. Do not reopen them unless the current code makes
one impossible.

1. A workflow role is not a CLI brand.
   - Role IDs are `general`, `script-generator`, `script-reviewer`, and
     `video-prompt`.
   - Existing CLI launcher IDs and notification hooks remain intact.
   - Do not rename or repurpose `AGENT_LAUNCHERS`.

2. Workstation presets are mutable workstation state.
   - They will live in the versioned Spaces store.
   - They will not be written to `workstation.json`.
   - Prompt contents remain normal files on disk.

3. The working directory is derived at launch time.
   - It is always the active workstation root.
   - It is not persisted in each preset.
   - It must not inherit a terminal's nested current directory.

4. Prompt paths are fixed root-relative paths:
   - `agents/script-generator/prompt.md`
   - `agents/script-reviewer/prompt.md`
   - `agents/video-prompt/prompt.md`
   - General Agent has no prompt file.

5. No automatic prompt injection.
   - PTY readiness only means the shell is ready.
   - It does not mean a Claude, Codex, Gemini, or OpenCode TUI is ready.
   - Never concatenate a prompt path or prompt text into a shell command.
   - The frontend will expose Open prompt and Copy startup instruction.

6. Phase 2 is Local-only, matching Phase 1 workstation creation.
   - Do not expand this assignment to WSL.

7. Phase 3 browser launchers and profiles are out of scope.

## Existing Architecture To Reuse

### CLI launchers

`src/modules/agents/lib/launcher.ts` already owns:

- `AGENT_LAUNCHERS`
- `AgentLauncherId`
- `AgentLaunchRequest`
- global per-CLI start commands
- command validation
- one-to-four-pane terminal plans

Existing launchers include Claude, Codex, Gemini, Pi, OpenCode, and Grok.
Do not remove Pi or Grok compatibility even though the Phase 2 product surface
focuses on Claude, Codex, Gemini, OpenCode, and Custom.

### Agent terminal launch

`src/app/App.tsx` owns `launchAgentGroup`. It creates terminal panes, enables
the real CLI's notification hooks, waits for shell readiness, and writes the
validated CLI command followed by carriage return.

`src/modules/tabs/lib/useTabs.ts` owns `newAgentGroupTab` and `newAgentTab`.

No new PTY spawn command is required for Phase 2.

### Workstations

`src/modules/spaces/lib/store.ts` owns the versioned workstation metadata.
`src/modules/spaces/lib/useSpaces.ts` owns workstation mutations.

The Phase 1 Rust scaffold is under:

- `src-tauri/src/modules/workstation/mod.rs`
- `src-tauri/src/modules/workstation/scaffold.rs`
- `src-tauri/src/modules/workstation/template.rs`

`workstation.json` deliberately contains only identity and creation metadata.

### File opening

The frontend already opens files through the tab system in `App.tsx`.
Markdown files can open in the rendered Markdown surface. The Rust control
bridge already demonstrates canonical, authorized regular-file validation.

### Executable lookup

`src-tauri/src/modules/lsp/env.rs` already resolves binaries using the captured
login-shell PATH on Unix and the inherited user PATH on Windows. Reuse or
narrowly expose this implementation. Do not create a second PATH-capture
system and do not execute a shell to detect CLIs.

## Claude Assignment

Claude owns the native support needed by the Phase 2 frontend:

1. Detect the four supported default CLI executables.
2. Resolve prompt and output-file references safely inside a workstation.
3. Add focused Rust tests for both commands.

This is a Rust-only assignment. Do not edit frontend files.

## Command 1: Agent CLI Detection

Add a Tauri command:

```text
agent_cli_detect() -> AgentCliDetection[]
```

Return entries in this stable order:

1. `claude` using executable `claude`
2. `codex` using executable `codex`
3. `gemini` using executable `gemini`
4. `opencode` using executable `opencode`

JSON shape:

```json
{
  "id": "claude",
  "command": "claude",
  "available": true,
  "resolvedPath": "C:/absolute/path/to/claude.exe"
}
```

Requirements:

- `id` and `command` are stable lowercase strings.
- `resolvedPath` is a canonical frontend path with forward slashes, or `null`.
- `available` is exactly `resolvedPath !== null`.
- Use the existing login-shell/user PATH resolution behavior.
- Run potentially blocking lookup work through `spawn_blocking`.
- Do not launch a CLI, run `--version`, source shell aliases, or inspect CLI
  authentication state.
- Custom commands are frontend configuration and are not detected here.
- Do not add a new dependency.

## Command 2: Secure Workstation File Resolution

Add a camelCase struct DTO and Tauri command:

```text
workstation_resolve_file(request: WorkstationFileRequest)
  -> WorkstationFileResolution
```

Request JSON:

```json
{
  "rootPath": "C:/Users/Admin/Afflow-workstation",
  "relativePath": "outputs/video-prompt.md"
}
```

Response JSON:

```json
{
  "root": "C:/Users/Admin/Afflow-workstation",
  "relativePath": "outputs/video-prompt.md",
  "absolutePath": "C:/Users/Admin/Afflow-workstation/outputs/video-prompt.md"
}
```

Validation requirements:

- Trim and reject an empty root or relative path.
- Require an absolute workstation root.
- Require `relativePath` to be relative.
- Reject root, prefix, parent (`..`), current-directory (`.`), and empty path
  components rather than normalizing them away.
- Resolve both root and target through filesystem canonicalization.
- Require the canonical root to be an existing directory.
- Require the canonical target to be an existing regular file.
- Reject directories, missing files, and special files.
- Require the canonical target to remain under the canonical root.
- Reject symlink or junction escapes after canonicalization.
- Require the root and target to be inside the existing authorized workspace
  registry. Do not create a second authorization registry.
- Return canonical forward-slashed paths through the existing fs helper.
- Do not open the file and do not read its contents.
- Do not execute shell commands.
- Keep the rule independent of specific prompt/output directories so the
  frontend can use the same secure command for known prompt paths and explicit
  referenced output paths.

Partial or ambiguous resolution is an error. Do not fall back to home and do
not search by basename.

## Suggested Native Layout

Prefer a focused module such as:

```text
src-tauri/src/modules/agent_presets.rs
```

or a clearly separated Phase 2 file under the existing workstation module.

Claude may touch only these areas:

- New Phase 2 Rust module and its tests
- A narrow export in `src-tauri/src/modules/mod.rs` if needed
- A narrow command registration in `src-tauri/src/lib.rs`
- `src-tauri/src/modules/lsp/env.rs` or `lsp/mod.rs` only if a minimal
  visibility change is needed to reuse executable resolution

Do not edit:

- `src/app/App.tsx`
- `src/modules/agents/**`
- `src/modules/spaces/**`
- `src/modules/tabs/**`
- `src/modules/terminal/**`
- `src/modules/settings/**`
- `src/settings/**`
- package manifests unless a real blocker is first reported
- `PROJECT.md`
- this handoff file

## Required Rust Tests

CLI detection tests:

- Stable IDs, executable names, and ordering
- Found command reports `available: true` and a path
- Missing command reports `available: false` and `resolvedPath: null`
- Detection uses an injected resolver in pure tests rather than depending on
  Claude/Codex/Gemini/OpenCode being installed on the test machine

File-resolution tests using real temporary directories:

- Resolves a normal prompt file
- Resolves a normal output file
- Produces forward-slashed root, relative, and absolute paths
- Rejects empty values
- Rejects a relative root
- Rejects an absolute target path
- Rejects `..`, `.`, prefix, and root components
- Rejects a missing target
- Rejects a directory target
- Rejects a root that is a file
- Rejects a target outside the root
- Rejects a symlink or junction escape after canonicalization
- Rejects an unauthorized root or target
- Handles Windows separators and drive-letter case without bypassing
  containment

Tests that require symlink privileges must be platform-aware, but the
production containment check is mandatory on every platform.

## Codex Work Running In Parallel

Claude should know these boundaries so it does not duplicate or collide with
other agents.

### Codex Agent A: Preset Domain And Persistence

Owns:

- `src/modules/agents/lib/presets.ts` and tests
- `src/modules/spaces/lib/store.ts` and tests
- `src/modules/spaces/lib/useSpaces.ts` and tests

Responsibilities:

- Four default workflow-role definitions
- Per-workstation preset persistence
- Spaces schema version 2 migration
- CLI selection and optional custom-command override model
- Per-workstation update/reset actions
- Malformed-data normalization and isolation tests

### Codex Agent B: Preset UI

Owns new component files only under `src/modules/agents/components/`.

Responsibilities:

- Compact four-role launcher/configuration surface
- CLI selection and custom-command editing
- Launch, Open prompt, Copy startup instruction, and output actions
- Missing CLI and prompt states
- Accessible keyboard, focus, loading, and error behavior
- Component tests

### Codex Agent C: Terminal File References

Owns terminal-only link parsing and renderer integration.

Responsibilities:

- Conservative links for explicit workspace-relative file references
- Pooled renderer callbacks resolved against the current leaf at click time
- No arbitrary prose parsing, shell execution, or `file://` external opening
- Parser, stale-leaf, and callback tests

### Lead Codex Agent

Owns all shared integration:

- Barrels and shared types
- `NewTabMenu`
- `App.tsx`
- Native TypeScript wrappers
- Launch orchestration
- Prompt and output-file opening
- Final visual verification, full test gates, commit, and push

## Integration Contracts Claude Must Preserve

- Detection IDs must match the existing launcher IDs exactly.
- File resolution must return canonical absolute paths suitable for
  `openFileTab` after the frontend selects the owning workstation.
- The native commands must be thin imperative shells around pure/testable
  functions.
- Errors must be readable strings that the frontend can surface directly.
- No credentials, tokens, prompt contents, process handles, or terminal state
  may be returned or persisted.
- Do not add CLI-specific startup flags or assume any CLI accepts startup text.
- Do not modify existing terminal agent hooks or OSC notification protocols.

## Verification Commands

Use the explicit cargo path if `cargo` is not on PATH:

```powershell
& 'C:\Users\Admin\.cargo\bin\cargo.exe' fmt --check
& 'C:\Users\Admin\.cargo\bin\cargo.exe' clippy --all-targets --locked -- -D warnings
& 'C:\Users\Admin\.cargo\bin\cargo.exe' test --locked
```

Do not run frontend formatting commands. Other agents may have in-flight
frontend work in the shared checkout.

## Coordination Rules

- Do not commit. The lead will review and create one combined Phase 2 commit.
- Do not stage unrelated files.
- Do not revert or reformat another agent's changes.
- Before changing `lib.rs`, `modules/mod.rs`, or LSP visibility, inspect the
  current diff and preserve concurrent edits.
- If a contract must change, stop and report the exact reason before editing
  beyond the approved assignment.
- When finished, remain available for review fixes.

## Required Return Report

Return all of the following:

1. Exact files changed
2. DTO and response shapes implemented
3. Validation and authorization behavior
4. Tests added and exact results
5. Clippy and cargo test results
6. Known limitations or risks
7. Integration steps for the lead
8. Confirmation that no frontend files were touched
9. Confirmation that nothing was committed

## Phase 2 Acceptance Checklist

The combined team implementation is complete only when:

- Every workstation has exactly four default workflow roles.
- Role configuration persists across restart and remains isolated by
  workstation.
- A Phase 1 store migrates without losing workstation identity, active state,
  tabs, or layout.
- At least one installed supported CLI can launch all four roles.
- Every role terminal starts at the canonical active workstation root.
- Missing CLI, missing root, missing prompt, and invalid custom command states
  fail clearly without creating a broken session.
- Each specialized role can open its prompt and copy its startup instruction.
- Explicit output references open only when they resolve to a regular file
  inside the owning authorized workstation.
- General Agent exposes no prompt action.
- No prompt content, credentials, tokens, PTY handles, or live terminal state
  is persisted in workstation configuration.
- Existing launcher hooks, notification routing, renderer pooling, Phase 1
  workstation switching, persistence, and archive guards remain intact.
- Frontend type-check, tests, build, lint, strict Clippy, full Rust tests, and
  native Windows visual verification pass.

## Scope Traps

- Do not treat the four roles as four CLI brands.
- Do not remove Pi or Grok compatibility.
- Do not add CLI-specific prompt flags.
- Do not parse arbitrary terminal prose as file references.
- Do not store mutable presets in `workstation.json`.
- Do not auto-start agent processes during hydration.
- Do not expand Phase 2 into browser profiles, browser launchers, product
  records, or WSL support.
- Do not let a pooled renderer callback retain a previous leaf or workstation.
