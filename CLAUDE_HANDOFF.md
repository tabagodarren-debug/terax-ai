# Claude Handoff: Afflow Phase 4

## Purpose

This document assigns Claude the Rust-only macOS browser-parity workstream for
Afflow Phase 4. The checkout is shared with Codex agents. Stay inside the file
boundary below, do not reformat unrelated files, and do not commit or stage.

## Repository State

- Repository: `C:\Users\Admin\Afflow`
- Phase 4 branch: `afflow/phase-4-daily-driver`
- Phase 4 base commit: `5c1da71` (`docs: plan Afflow Cloud sync`)
- Phase 3 implementation commit: `ee6b49b`
- Package manager: pnpm only
- Frontend: React 19 and TypeScript
- Native app: Tauri 2 and Rust
- Current state: Phases 0 through 3 are implemented and committed. Phase 3
  native browser commands are registered and their Windows automated tests are
  green. Manual signed-in browser persistence, isolated-cookie, and real-site
  upload/download acceptance still belong to the user acceptance pass.
- Shared checkout rule: other agents may change unrelated files while Claude
  works. Never revert, clean, stage, commit, or reformat their changes.

Read before editing:

1. `AGENTS.md`
2. `TERAX.md`
3. `PROJECT.md`, especially Phase 4, Sections 8.3, 10, 12, 14, and 15
4. This file
5. The existing `src-tauri/src/modules/browser/` implementation and tests

## Combined Phase 4 Scope

Phase 4 makes Afflow dependable as a daily driver and establishes the portable
state boundary needed by the later cloud-sync phase.

The combined Codex and Claude implementation covers:

- Crash and unclean-shutdown recovery
- Browser launch and profile-lock recovery
- Chrome and Edge support on Apple Silicon macOS 13+
- Device-local workstation roots and portable relative-path state
- Unsaved-file protection and missing shortcut coverage
- Windows development packaging
- Cross-platform CI, performance checks, and manual acceptance

Claude owns only the macOS native browser slice described below.

## Claude Assignment

Extend the existing Phase 3 browser module so the same six commands work on
macOS without changing their DTOs:

```text
browser_detect
browser_validate_executable
browser_profile_status
browser_launch
browser_profile_open_folder
browser_profile_reset
```

The assignment includes:

1. Native Chrome Stable and Edge Stable detection on macOS.
2. Platform-correct executable override validation.
3. Real macOS Chromium profile-activity detection with `flock`.
4. Safe idle-profile reset on macOS, including after Afflow restarts.
5. Focused Rust tests and any narrow internal browser-module refactor needed
   to keep Windows behavior unchanged.

Do not add new commands or change frontend request/response shapes.

## Frozen Product and Security Decisions

These decisions are approved. Do not reopen them unless the current code makes
one impossible.

1. Target Apple Silicon macOS 13+ for this phase.
   - Keep Windows behavior and tests unchanged.
   - Linux remains best effort: browser detection may report unavailable and
     profile activity may remain `unknown`.
   - Do not add Firefox, Safari, Arc, Chromium variants, channels, or mobile.

2. Continue launching a normal external browser.
   - Do not use an embedded webview, iframe, browser automation, AppleScript,
     `open -a`, remote debugging, shell string, or page inspection.
   - Spawn the validated browser executable directly with structured args.
   - Browsers still outlive Afflow and are never attached to the PTY Job
     Object or killed during reset/shutdown.

3. Public contracts remain frozen.
   - Preserve every Phase 3 camelCase DTO and exact response key.
   - Preserve browser ordering: Chrome, then Edge.
   - Preserve `available === (resolvedPath !== null)`.
   - Preserve canonical forward-slashed display/response paths.
   - Preserve native separators in the actual `--user-data-dir` argv value.

4. Browser profiles remain device-local.
   - Use the existing native-derived app-local profile base and marker.
   - Never accept a profile path over IPC.
   - Never read, copy, export, or synchronize cookies, browser storage,
     passwords, sessions, or tokens.
   - The same logical profile ID on Windows and macOS names independent local
     directories; it does not transfer authentication.

5. Reset remains fail-closed.
   - `confirmed: true` is still mandatory.
   - A tracked child or held native lock means `active`.
   - An ambiguous native error means `unknown`.
   - Reset is permitted only when activity is proven `idle`.
   - Never delete or unlink Chromium's lock file as a recovery technique.
   - Never kill Chromium, follow a symlink, or delete outside the marked
     Afflow-managed profile.

6. No caller-provided flags.
   - Preserve the existing backend-only flags and URL validation.
   - Every URL remains its own `Command::arg`.
   - Never log complete URLs, query strings, commands, browser output, or
     profile contents.

## Existing Implementation To Reuse

- `browser/mod.rs` owns the DTOs, `BrowserState`, command functions, child
  tracking, per-profile locks, detection dispatch, and command tests.
- `browser/detect.rs` owns candidate ordering, executable verification, and
  override validation. Its current install-root model is Windows-specific and
  may be refactored internally.
- `browser/profile.rs` owns native-derived profile paths, ownership markers,
  containment, activity mapping, quarantine reset, and most filesystem tests.
- `browser/launch.rs` already builds the cross-platform structured Chromium
  argv. Do not add a macOS shell/opener path.
- `browser/windows.rs` owns App Paths lookup, the Windows sharing probe,
  reparse detection, and no-follow cleanup. Some no-follow helpers are actually
  cross-platform and may be extracted if that reduces platform branching.
- `lsp/env.rs::resolve_binary` supplies the GUI-safe PATH overlay used by
  native detection.
- `fs::to_canon` supplies frontend/display canonicalization.
- `proc::hide_console` is a Windows no-op boundary elsewhere and does not need
  a macOS replacement.
- The target already depends on `libc` through the Unix dependency section.
  Use it for `open`, `flock`, and `close`; no new crate is expected.

## macOS Detection Contract

Return Chrome then Edge. For each browser, try candidates in this order and
select the first verified executable:

```text
Google Chrome:
  /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  ~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  GUI-safe PATH lookup for "Google Chrome"

Microsoft Edge:
  /Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge
  ~/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge
  GUI-safe PATH lookup for "Microsoft Edge"
```

Requirements:

- Resolve `~` through `dirs::home_dir()`, never string expansion or raw
  `$HOME`.
- A missing home directory only removes the user-Applications candidate.
- Canonicalize every candidate before accepting it.
- Require an existing regular file with at least one Unix execute bit.
- Require the exact platform basename: `Google Chrome` or `Microsoft Edge`.
- Do not accept the `.app` directory as the executable.
- Ignore stale, missing, non-executable, directory, and wrong-basename
  candidates and continue to the next source.
- Detection never executes the browser, asks Launch Services, reads a version,
  or inspects authentication.
- Keep candidate construction and verification injectable/pure enough that
  ordinary tests do not depend on browsers installed on the test host.

Windows keeps its existing registry, standard-location, basename, `.exe`, and
PATH behavior. Do not make Windows use macOS names or paths.

## Executable Override Contract

`browser_validate_executable` and launch-time revalidation use the same native
rules.

On macOS:

- Reject blank, relative, missing, directory, and non-executable paths.
- Canonicalize the selected internal app-bundle executable.
- Chrome requires basename `Google Chrome`.
- Edge requires basename `Microsoft Edge`.
- Do not require `.exe` and do not accept an `.app` directory.
- Return the existing `{ browserId, path }` response only.

On Windows, preserve exact Phase 3 behavior: `.exe` is mandatory and the
basenames remain `chrome.exe` and `msedge.exe`.

An override moved after selection must fail again during `browser_launch`.

## macOS Profile Activity Contract

Chromium uses `<user-data>/SingletonLock` on macOS and holds a BSD advisory
exclusive lock for the running profile. Probe that lock directly.

Implement the equivalent of:

1. If `BrowserState` still has a live tracked child for the profile, report
   `active` without weakening this proof.
2. Open an existing `SingletonLock` with `O_RDWR | O_CLOEXEC`; do not use
   `O_CREAT`, `O_TRUNC`, or write or truncate the file.
3. A missing file or missing parent is `idle` when no tracked child exists.
4. Attempt `flock(fd, LOCK_EX | LOCK_NB)`.
5. `EWOULDBLOCK` or `EAGAIN` is `active`.
6. A successfully acquired lock is immediately unlocked and closed and means
   `idle`.
7. Permission denial, invalid entry type, unsupported locking, open failure,
   lock failure, or close ambiguity is `unknown`.

Never create, truncate, rename, remove, or repair `SingletonLock`. Its presence
alone is not activity: only a held lock is active. A stale but unlocked file is
idle and may be reused by Chromium.

The existing Windows probe continues to inspect `<user-data>/lockfile` with
Windows sharing semantics. Make lock filename selection platform-specific
rather than probing both names.

The upstream behavior being mirrored is Chromium's own macOS
`ProcessSingleton` use of non-blocking exclusive `flock` on the profile lock.

## macOS Profile and Reset Safety

- Keep the existing directory layout and exact marker schema.
- Continue rejecting symlinked profile families, containers, markers, and
  `user-data` directories.
- Continue canonical containment under app-local data.
- The current Unix no-follow cleanup must unlink symlinks themselves and never
  descend through them.
- `browser_profile_status` remains read-only and does not create a profile.
- Folder-open and launch may create a missing marked profile through existing
  code.
- Reset holds the existing per-profile operation lock through activity check,
  quarantine rename, clean-directory creation, rollback, and cleanup.
- Reset of `active` or `unknown` profiles fails with the current user-facing
  close-browser behavior.
- A free stale lock file must not prevent reset, but reset removes it only as
  part of quarantining the complete `user-data` directory; do not special-case
  or unlink it first.
- Preserve marker and sibling profiles byte-for-byte.
- Preserve `cleanupPending` behavior and never claim deletion that failed.

## Internal Module Shape

Keep platform mechanics explicit. The preferred result is:

```text
src-tauri/src/modules/browser/
|-- mod.rs
|-- detect.rs
|-- profile.rs
|-- launch.rs
|-- windows.rs
`-- macos.rs
```

A small internal `platform.rs` is allowed if it cleanly dispatches executable
names, candidates, lock filenames, activity probes, and shared no-follow
helpers. Do not introduce a second browser state or duplicate public commands.

## Claude File Boundary

Claude may touch only:

- `src-tauri/src/modules/browser/**`
- `src-tauri/Cargo.toml` and `Cargo.lock` only if a narrowly required native
  dependency or feature is genuinely missing; `libc` is already available

Do not edit:

- `src/**`
- `src-tauri/src/lib.rs` or `src-tauri/src/modules/mod.rs` unless compilation
  proves a minimal registration change is unavoidable; no new command is
  expected
- PTY, workspace, workstation, filesystem, secrets, control, LSP, or shell
  modules
- Tauri configuration, capabilities, entitlements, installer files, or GitHub
  workflows
- `PROJECT.md`, `TERAX.md`, `CLAUDE.md`, `AGENTS.md`, or this handoff
- package manifests outside `src-tauri/Cargo.toml`

If another agent changes a browser file while Claude is working, stop and
report the collision instead of reverting or overwriting it.

## Required Rust Tests

### Detection

- Fixed Chrome-then-Edge order on every platform
- macOS system Applications path wins over user Applications and PATH
- Missing system candidate falls through to user Applications
- Missing user candidate falls through to GUI-safe PATH
- Chrome only, Edge only, both, and neither
- Missing home directory does not fail detection
- Stale, directory, wrong-basename, and non-executable candidates fall through
- Canonical forward-slashed response path
- `available` always matches `resolvedPath`
- Windows precedence and `.exe` expectations remain covered and green

### Override validation

- Valid macOS Chrome and Edge internal executables
- Blank, relative, missing, directory, `.app` directory, wrong browser, and
  non-executable paths rejected
- Canonical path returned
- Moved override fails on revalidation
- Windows valid/invalid override tests remain unchanged in behavior

### Activity

- Tracked live child is active regardless of native probe
- Missing macOS `SingletonLock` is idle
- Existing unlocked macOS `SingletonLock` is idle and untouched
- A real separately held exclusive lock is active
- Permission/error/invalid-entry outcomes are unknown
- Probe never creates, truncates, writes, renames, or removes the lock
- macOS uses `SingletonLock`; Windows still uses `lockfile`

### Profile and reset

- macOS status after an Afflow restart derives activity from `flock`, not PID
- Active and unknown macOS profiles refuse reset
- Idle macOS profile resets successfully
- Stale unlocked lock does not block reset
- Marker and sibling profiles survive reset byte-for-byte
- Missing `user-data` remains idempotent
- Symlink escapes and cleanup traversal remain rejected
- Rename, recreation, rollback, and cleanup failure behavior stays covered
- Exact Phase 3 DTO serialization remains unchanged

Use injected functions for deterministic cross-platform logic and real tempdir
I/O for safety boundaries. macOS-specific `flock` tests must be gated with
`#[cfg(target_os = "macos")]` and genuinely hold the file lock on the macOS CI
runner. Do not silently pass a security test by skipping a failed setup.

## Verification Gates

Run from `src-tauri`:

```text
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

Format only changed Rust files. The repository may not be globally
`cargo fmt --check` clean, so do not format unrelated files.

The lead will run macOS CI after integration. Claude should still keep every
macOS-only API behind the correct `cfg` boundary so the Windows gates compile
and pass locally.

## Claude Return Report

Report:

1. Exact files changed.
2. Internal platform split and executable-name mapping.
3. macOS detection order and validation behavior.
4. Exact `SingletonLock`/`flock` probe behavior and error mapping.
5. Profile reset behavior on macOS.
6. Tests added and exact results.
7. Clippy and Cargo results.
8. Anything that still requires a physical Mac acceptance test.
9. Known limitations or Chromium assumptions.
10. Confirmation that no frontend, packaging, workflow, or unrelated file was
    touched.
11. Confirmation that nothing was committed or staged.

## Codex Workstreams In Parallel

Claude must not implement these tasks.

### Codex Agent A: Crash Recovery

- Add a native clean/unclean session marker with atomic writes and strict DTOs
- Coordinate startup detection with the existing Spaces/tab persistence
- Restore the last safe workstation state after an unclean exit
- Add recovery/discard UI and avoid repeated recovery prompts
- Test clean exit, process crash, corrupted marker, first run, and failed state
  restoration

### Codex Agent B: Portable Workstation State

- Convert persisted editor, Markdown, and terminal cwd references from raw
  absolute paths to workstation-relative references
- Keep workstation roots device-local and authorize them before resolving tabs
- Migrate existing Spaces data without losing Windows roots
- Restore portable state under either Windows or macOS separators
- Add missing/moved-root recovery and schema migration tests

### Codex Agent C: Daily-Driver UX

- Audit and complete Save All, dirty-editor, app-close, workspace-switch, and
  terminal-process guards
- Add browser busy/unknown recovery UX, retry, open-profile, and cleanup-pending
  handling using existing native commands
- Fill missing keyboard shortcuts without overriding shell-native keybindings
- Add focused component and interaction tests

### Codex Lead: Packaging, Performance, and Integration

- Build the Windows development installer and record reproducible commands
- Extend CI/acceptance coverage without changing Claude-owned browser files
- Test repeated browser launches, multiple terminals, restart restoration, and
  memory/startup budgets
- Integrate all workstreams, run full frontend and Rust gates, then coordinate
  physical Windows and MacBook acceptance

## Stop Conditions

Stop and report instead of guessing if:

- Current Chrome or Edge on macOS demonstrably does not use the documented
  `SingletonLock` advisory lock.
- A safe activity result would require launching, signaling, killing, or
  inspecting browser processes outside the tracked child handles.
- Correctness requires reading browser profile contents, cookies, or auth data.
- The existing public DTO must change.
- A needed edit falls outside the Claude file boundary.
- Shared-checkout changes collide with Claude's browser files.
