# Afflow Architecture Baseline

This document records the Terax architecture inherited by Afflow at upstream
commit `468fd7fcc48aef4af85a2ff8c46d0c8058d17c25` (`0.8.6`). It is the Phase 0
reference for implementing workstations without duplicating existing state or
breaking terminal, file, and editor behavior.

## 1. Frontend entry and routing

- Vite builds two HTML entries through `vite.config.ts`: `index.html` for the
  primary window and `settings.html` for the settings window.
- `src/main.tsx` initializes launch-directory state, closes orphaned PTYs left
  by a prior webview load, renders `src/app/App.tsx`, and shows the initially
  hidden Tauri window after the first paint.
- `src/settings/main.tsx` independently renders
  `src/settings/SettingsApp.tsx`. The Rust command `open_settings_window` in
  `src-tauri/src/lib.rs` creates or focuses that second webview window and can
  emit a settings-section event.
- There is no URL router. The primary application is a state-driven desktop
  surface, while settings navigation is local component state.
- `src/app/App.tsx` is the main coordinator. It wires tabs, spaces, terminal
  sessions, explorer state, editors, previews, source control, AI surfaces,
  dialogs, and application-level shortcuts.

Phase 1 implication: workstation navigation should remain application state,
not introduce a browser router. The main composition change belongs near
`App.tsx`, with domain behavior kept in `src/modules/spaces/` or a deliberately
renamed successor.

## 2. Tab, pane, and space state

- `src/modules/tabs/lib/useTabs.ts` owns the tab collection and active tab.
  `Tab` is a tagged union covering terminal, editor, URL preview, Markdown,
  AI diff, Git diff, Git history, and commit-file surfaces.
- Every tab has a `spaceId`. New tabs use the currently active space, tabs can
  move between spaces, and removing a space moves or replaces its tabs through
  the existing tab planning functions.
- Terminal tabs contain a pane tree from
  `src/modules/terminal/lib/panes.ts`. Leaf IDs are stable terminal-session
  identities; split containers describe direction, size, and child panes.
- `src/app/components/WorkspaceSurface.tsx` mounts one stack per tab kind in
  absolute layers. Inactive stacks are hidden instead of unmounted so terminal
  buffers, editors, and preview state survive tab changes.
- `src/modules/spaces/lib/useSpaces.ts` is a Zustand store for the ordered
  space list, active space, initial tab index, and hydration state.
- `src/modules/spaces/lib/store.ts` defines `SpaceMeta` with `id`, `name`,
  `root`, execution `env`, optional color, and timestamps. This already matches
  most of the proposed workstation identity.
- `src/modules/spaces/SpaceSwitcher.tsx` exposes space creation, switching,
  rename, deletion, reordering, per-space tab lists, and cross-space tab moves
  in a popover.

Phase 1 implication: an Afflow workstation should evolve `SpaceMeta` and the
spaces store. A second workstation store would create conflicting owners for
tab membership, active context, restoration, and deletion.

## 3. Terminal and PTY lifecycle

- `src/modules/terminal/TerminalStack.tsx` renders all warm terminal tabs and
  maps terminal leaves to `TerminalPane` instances while keeping callbacks
  stable across renders.
- `src/modules/terminal/lib/useTerminalSession.ts` owns the frontend session
  registry. It creates xterm state, starts a PTY, tracks cwd and agent activity,
  handles retries and exits, checks foreground jobs, and disposes sessions by
  terminal leaf ID.
- `src/modules/terminal/lib/pty-bridge.ts` translates a frontend session into
  the Tauri commands `pty_open`, `pty_write`, `pty_resize`, and `pty_close`.
  Tauri channels carry raw output and exit events back to the frontend.
- `src-tauri/src/modules/pty/mod.rs` owns the command boundary and session map.
  `src-tauri/src/modules/pty/session.rs` uses `portable-pty` to spawn the native
  shell, stream output, resize, terminate, and reap the process.
- `src/main.tsx` calls `pty_close_all` before the first tab mounts to reap PTYs
  orphaned by a webview reload. `App.tsx` also disposes live leaves when the
  execution environment is reset.
- Terminal cwd is dynamic. A pane may move below its initial workstation root;
  this is valid terminal behavior and must not redefine workstation identity.

Phase 1 implication: create and switch workstations through the existing tab
and space APIs. Do not tie PTY disposal to React unmounts or dispose all PTYs
when merely switching workstations, because inactive workstation tabs are
expected to remain live.

## 4. Explorer and drag and drop

- `src/modules/explorer/FileExplorer.tsx` renders a virtualized tree rooted at
  its `rootPath` prop. Its tree hook reads directories, watches changes, and
  exposes create, rename, delete, copy, refresh, and selection operations.
- Rust filesystem commands live under `src-tauri/src/modules/fs/`. The command
  set includes directory reads, file reads and writes, metadata, canonicalize,
  create, rename, delete, copy, search, grep, glob, and filesystem watches.
- `src/modules/explorer/lib/useExplorerDnd.ts` implements internal pointer-based
  moves and can hand a dragged path to the terminal drop target.
- `src/modules/explorer/lib/useExplorerFileDrop.ts` listens for Tauri native
  file drops and copies external files into the root or selected directory.
- `src/modules/terminal/lib/useTerminalFileDrop.ts` accepts explorer or native
  paths and writes shell-escaped paths into the target terminal.
- `src/modules/tabs/lib/useWorkspaceCwd.ts` currently derives `explorerRoot`
  from the active terminal cwd, then the last terminal cwd, then any terminal,
  and finally home. `App.tsx` passes that derived value to `FileExplorer`.

Phase 1 implication: this cwd-derived explorer root conflicts with the Afflow
requirement that a workstation owns a stable root directory. Replace only the
explorer-root selection with active `SpaceMeta.root`. Keep the existing cwd
inheritance logic for new terminal tabs unless product behavior requires a
separate rule.

## 5. Editor and media previews

- `src/modules/editor/EditorStack.tsx` keeps one `EditorPane` mounted per warm
  editor tab and only exposes the active pane.
- `src/modules/editor/EditorPane.tsx` uses CodeMirror 6 for supported text and
  code documents. It also uses Tauri's asset protocol to render image, video,
  audio, and PDF content from local paths.
- `src/modules/editor/lib/useDocument.ts` reads, stats, writes, and reloads files
  through Rust filesystem commands. It tracks dirty state, modification time,
  file size limits, save state, and external changes.
- Markdown has a distinct tab type and stack under `src/modules/markdown/`.
  It can switch between rendered preview and raw editor modes while retaining
  the same path identity.
- `App.tsx` centralizes file-open planning, path rename propagation, path delete
  cleanup, dirty-close guards, and editor reloads after filesystem events.

Phase 1 implication: workstation switching should filter visibility through
existing `spaceId` membership. It should not remount editors or implement a new
file viewer. Workstation deletion must continue through existing tab cleanup so
dirty-document and active-session guards remain effective.

## 6. Existing URL preview

- `src/modules/preview/PreviewStack.tsx` keeps warm preview tabs mounted and
  suspends hidden preview iframes after 30 seconds to release memory.
- `src/modules/preview/PreviewPane.tsx` renders a sandboxed iframe. It allows
  scripts, same-origin storage, forms, popups, downloads, and clipboard access,
  but omits top-navigation permissions to protect the parent Tauri webview.
- `src/modules/preview/PreviewAddressBar.tsx` normalizes URLs, probes common
  localhost development ports, reloads the iframe, and opens a URL externally
  through `@tauri-apps/plugin-opener`.
- The Content Security Policy in `src-tauri/tauri.conf.json` permits HTTP and
  HTTPS frames and local development connections.
- Public sites may refuse iframe embedding through frame policies, and preview
  tabs do not provide isolated browser identities.

Afflow decision: retain this surface only as a development and local URL
preview. Do not extend it into the workstation browser. Phase 3 should launch a
normal external Chrome or Edge process with an Afflow-managed profile directory
for each workstation. No cookie inspection, cookie transfer, or embedded
general browsing is required.

## 7. Persistence and startup

- `src/modules/spaces/lib/store.ts` uses `tauri-plugin-store` with a list of
  space metadata, the active space ID, and a separate serialized state record
  per space.
- `src/modules/spaces/lib/serialize.ts` persists terminal pane trees and cwd,
  editor paths, preview URLs, and Markdown paths. Transient AI and Git tabs are
  intentionally excluded.
- `src/modules/spaces/lib/useSpacePersistence.ts` groups tabs by `spaceId` and
  writes changed snapshots after a three-second debounce. It also flushes on
  blur, hidden visibility, unload, and hook cleanup.
- `src/modules/spaces/lib/useSpacesBoot.ts` loads spaces, creates a first-run
  default space when needed, restores serializable tabs, authorizes restored
  cwd values, applies the active execution environment, and guarantees at
  least one terminal in the active space.
- General preferences and model settings use
  `src/modules/settings/store.ts`. Additional feature stores persist AI
  sessions, snippets, agents, custom themes, and UI geometry independently.
- `tauri-plugin-window-state` restores geometry and window state except
  visibility. The frontend deliberately controls first show timing.

Phase 1 implication: extend the existing persisted space schema with explicit
versioning and migration before adding workstation-only fields. Keep stable IDs
and preserve current tab snapshots. A clean Afflow application identifier will
place new application data in a separate OS directory from Terax.

## 8. Tauri commands, permissions, and capabilities

- `src-tauri/src/lib.rs` registers the application plugins, managed state, and
  all invoke commands. Major command groups are PTY, filesystem, LSP, Git,
  shell jobs, Local/WSL environment, control bridge, agent hooks, secrets,
  model networking, command history, and window appearance.
- `src-tauri/capabilities/default.json` grants both `main` and `settings`
  windows core window/event access plus opener, logging, OS, notifications,
  store, and limited autostart permissions.
- Sensitive OS access is implemented as explicit Rust commands rather than a
  broad frontend shell plugin. Filesystem and process work should continue to
  pass through those Rust boundaries.
- `src-tauri/src/modules/workspace.rs` maintains an authorization registry for
  allowed roots and spawn cwd values. Restored terminal directories are
  authorized during boot.
- The asset protocol is currently scoped to all paths in Tauri configuration.
  This is broader than a workstation root and should be reviewed before a
  hardened release, but narrowing it is not required to establish Phase 1 UI.

Phase 3 implication: browser discovery and launch should be a narrow Rust
command accepting a workstation ID, validated URL, browser choice, and profile
policy. Rust should derive the managed profile path. The frontend should never
accept or assemble arbitrary executable paths or shell command strings.

## 9. Build and packaging

- `package.json` uses pnpm and provides Vite, test, lint, type-check, and Tauri
  scripts. Tauri's pre-dev and pre-build hooks compile the bundled CLI sidecar
  before starting or building the frontend.
- `scripts/build-cli.mjs` builds the `terax-cli` workspace crate for the host or
  requested target and copies it into Tauri's target-specific sidecar path.
- `src-tauri/Cargo.toml` defines the desktop binary/library plus the CLI and
  control-protocol workspace crates. The CLI and control protocol are tightly
  coupled to shell integration and the single-instance control server.
- `src-tauri/tauri.conf.json` controls product identity, CSP, icons, sidecars,
  updater artifacts, file associations, package descriptions, and platform
  bundle settings. Windows uses an NSIS current-user installer configured in
  the same file and `src-tauri/tauri.windows.conf.json` overrides window chrome.
- The inherited updater points at official Terax releases and must not remain
  active in an Afflow-branded binary. Afflow needs its own signed release feed
  before automatic updates can be enabled.

Phase 0 rename rule: change the user-visible desktop identity and primary
binary while retaining `terax-cli`, protocol names, shell integration tokens,
CSS hooks, persisted key names, and event names as compatibility internals.
Renaming those internals now would create a large, low-value regression surface.

## 10. Smallest Phase 1 change surface

The smallest credible implementation path is:

1. Add schema versioning and workstation fields to
   `src/modules/spaces/lib/store.ts`, with a migration from current `SpaceMeta`.
2. Add focused store actions and tests in
   `src/modules/spaces/lib/useSpaces.ts` for create, rename, reorder, root
   change, and guarded delete. Preserve existing stable IDs and tab ownership.
3. Adapt `src/modules/spaces/SpaceSwitcher.tsx` into a persistent workstation
   sidebar or compose a new sidebar from the same store and actions. Do not
   duplicate persistence or tab grouping.
4. Update `src/app/App.tsx` to compose the persistent workstation sidebar and
   source explorer root from the active workstation record.
5. Split `src/modules/tabs/lib/useWorkspaceCwd.ts` into two clear concerns:
   stable workstation explorer root and dynamic cwd inheritance for new
   terminals. Add tests for switching while terminals have navigated elsewhere.
6. Extend `src/modules/spaces/lib/serialize.ts`, `useSpacesBoot.ts`, and
   `useSpacePersistence.ts` only where the workstation schema requires it.
7. Add integration tests for create, switch, restore, rename, delete, tab move,
   and stable explorer root. Then verify terminal sessions remain alive across
   workstation switches and dirty editor guards still apply.

### Primary risks

- Terminology collision: current `workspace` code means Local or WSL execution
  environment, while Afflow uses workstation for a saved project context. Keep
  these as separate concepts in names and types.
- Root/cwd coupling: changing `useWorkspaceCwd` without separating its two
  responsibilities can break new-terminal cwd behavior.
- Lifecycle coupling: unmounting hidden workstation content can destroy PTY,
  editor, or preview state that the current stacked design intentionally keeps.
- Persistence migration: changing store paths or record shapes without a
  migration can silently orphan sessions or overwrite a first-run default.
- Delete semantics: a workstation record may be removed, but its root directory
  must never be deleted. Existing space deletion already removes only metadata
  and tab state and should remain the foundation.
- Upstream compatibility internals: CLI names, IPC event names, shell escape
  sequences, CSS class names, and store keys contain `terax`. Treat them as
  protocol identifiers until a separately tested migration is justified.

## Baseline verification

The unmodified baseline was verified on Windows 11 with Node 24, pnpm 11.9,
Rust 1.98, and Visual Studio Build Tools 2022:

- `pnpm lint`: passed with inherited warnings only.
- `pnpm check-types`: passed.
- `pnpm test`: 102 files and 685 tests passed.
- `cargo check --locked`: passed with one inherited unused-variable warning.
- `pnpm tauri dev`: compiled and launched the native desktop application.
