# Claude Handoff: Afflow Phase 3

## Purpose

This document gives Claude the exact context, ownership boundary, native
contracts, security rules, and verification requirements for Afflow Phase 3.
The checkout is shared with Codex agents. Do not edit outside the assigned
files and do not commit.

## Repository State

- Repository: `C:\Users\Admin\Afflow`
- Phase 3 branch: `afflow/phase-3-browser-profiles`
- Phase 2 implementation commit: `f741568`
- Phase 2 handoff commit: `c0b5f9b`
- Phase 1 implementation commit: `82c2fa9`
- Package manager: pnpm only
- Frontend: React 19 and TypeScript
- Native app: Tauri 2 and Rust
- Current state: Phases 0, 1, and 2 are implemented, verified, committed, and
  pushed. Phase 3 starts from a clean Phase 2 branch tip.
- Shared checkout rule: other agents may modify unrelated files while Claude
  works. Do not revert, reformat, stage, commit, or clean their changes.

Read these files before editing:

1. `AGENTS.md`
2. `TERAX.md`
3. `PROJECT.md`, especially sections 6, 8.1, 8.3, 8.6, 9, 10, 12, 13,
   Phase 3, the browser test matrix, and the MVP acceptance criteria
4. This file

## Phase 3 Product Scope

Phase 3 adds a launcher for external Chrome and Edge windows with Afflow-owned
browser profiles.

The combined implementation must:

- Detect installed Chrome Stable and Edge Stable on Windows 11.
- Allow a global preferred browser and a validated executable override.
- Give each workstation an isolated managed profile by default.
- Offer one explicit shared Afflow profile mode.
- Persist ordered website launchers per workstation.
- Open one or more saved URLs in a dedicated normal browser window.
- Keep sign-ins inside the selected browser profile across restarts, subject
  to the website and browser's own session rules.
- Open the selected managed profile folder.
- Reset only an Afflow-managed profile after explicit confirmation and a
  native activity check.
- Leave the user's normal Chrome and Edge profiles untouched.

Phase 3 exit criterion:

> Each workstation launches the correct normal browser profile and saved
> websites, sign-ins persist, isolated profiles do not share sessions, and a
> manual upload/download workflow succeeds on a representative AI media site.

## Frozen Architecture Decisions

These decisions are approved. Do not reopen them unless the current code makes
one impossible.

1. Phase 3 targets Windows 11, Chrome Stable, and Edge Stable.
   - Keep the Rust module compilable on other desktop targets.
   - Non-Windows detection may return unavailable results for this phase.
   - Do not expand to Firefox, Chromium variants, beta/dev channels, mobile,
     or WSL.

2. Afflow launches an external normal browser.
   - Do not add an embedded webview, iframe, browser automation, remote
     debugging, extension injection, or page inspection.
   - The browser owns tabs, authentication, cookies, uploads, downloads,
     pop-ups, permissions, clipboard behavior, and media playback.
   - Afflow does not promise exact browser-tab restoration.

3. Chrome and Edge never share a user-data directory.
   - Managed paths include both browser ID and profile ID.
   - The same logical shared profile ID still resolves to different Chrome and
     Edge directories.

4. Profile paths are native-owned.
   - The frontend supplies only `browserId` and an opaque `profileId`.
   - Rust derives every path from `app.path().app_local_data_dir()`.
   - Never accept a profile directory or user-data path over IPC.
   - Never derive a profile path from a workstation name.

5. Managed profile layout is fixed:

   ```text
   <app-local-data>/browser-profiles/<browser-id>/<profile-id>/
   |-- .afflow-profile.json
   `-- user-data/
   ```

   Chromium receives only the `user-data` path through `--user-data-dir`.
   The marker remains outside browser-owned data.

6. Browser configuration uses existing persistence boundaries.
   - Global settings own the preferred browser and executable overrides.
   - Spaces schema version 3 owns workstation profile mode, isolated profile
     ID, saved tools, and optional auto-open preference.
   - Browser profile contents never enter the Spaces store or
     `workstation.json`.

7. Shared and isolated IDs are stable.
   - Shared mode uses the reserved logical ID `shared-v1`.
   - Every workstation retains a distinct isolated profile ID even while
     shared mode is selected.
   - Switching back to isolated mode restores that workstation's prior
     session.
   - Renaming or archiving a workstation never renames or deletes profile
     data.
   - Future workstation duplication must generate a fresh isolated profile ID
     and must never copy browser-profile contents.

8. A selected executable override is still Chrome or Edge.
   - It is not an arbitrary command, flags field, or shell string.
   - A Chrome override must resolve to `chrome.exe`.
   - An Edge override must resolve to `msedge.exe`.
   - Native code revalidates the executable at launch time.

9. Browser processes outlive Afflow.
   - Do not attach them to the existing kill-on-close Job Object.
   - Do not kill a browser automatically during reset or app shutdown.
   - Child tracking is useful but is not sufficient proof that a Chromium
     profile is idle after handoff or an Afflow restart.

10. Reset fails closed.
    - Confirmation in the UI is repeated as `confirmed: true` at the native
      boundary.
    - Unknown activity or a sharing/permission error means refuse reset.
    - Never recursively delete a caller-provided path.
    - A reset race with launch is prevented by a native per-profile operation
      lock.

11. URLs are data, never command text.
    - Parse them structurally.
    - Allow absolute HTTP and HTTPS URLs only.
    - Reject credentials, control characters, empty values, unsupported
      schemes, and excessive input.
    - Pass every URL as a separate `Command::arg`.

## Existing Architecture To Reuse

- `src-tauri/src/lib.rs` owns module imports, managed state, plugins, and the
  command handler list.
- `src-tauri/src/modules/mod.rs` owns native module exports.
- `src-tauri/src/modules/secrets.rs` demonstrates
  `app.path().app_local_data_dir()`.
- `src-tauri/src/modules/fs/mod.rs` exports `fs::to_canon`.
- `src-tauri/src/modules/workstation/resolve.rs` demonstrates canonical
  containment and real-tempdir tests.
- `src-tauri/src/modules/proc/mod.rs` exports `proc::hide_console`.
- Do not reuse `proc::job::ProcessJob`; it would kill the external browser.
- `src-tauri/src/modules/lsp/env.rs` provides GUI-safe PATH lookup as a final
  fallback.
- `src/modules/spaces/lib/store.ts` owns Spaces schema version 2.
- `src/modules/spaces/lib/useSpaces.ts` owns workstation mutations.
- `src/modules/settings/store.ts` owns global preferences and cross-window
  events.
- `src/settings/SettingsApp.tsx` owns settings sections and deep links.
- The existing Preview tab is for local dev servers and must not be reused.

## Claude Assignment

Claude owns all native Phase 3 browser support:

1. Chrome and Edge detection on Windows.
2. Explicit Chrome/Edge executable validation.
3. Safe managed profile creation and status.
4. Structured external-browser launch.
5. Profile-folder opening.
6. Confirmed, activity-aware managed-profile reset.
7. Focused Rust tests for all native rules.

This is a Rust-only assignment. Do not edit frontend files.

Prefer one focused module directory:

```text
src-tauri/src/modules/browser/
|-- mod.rs
|-- detect.rs
|-- profile.rs
|-- launch.rs
`-- windows.rs
```

A single `browser.rs` is acceptable if it stays readable. Keep platform code
behind the correct `cfg` boundary.

## Command 1: Browser Detection

Add:

```text
browser_detect() -> BrowserDetection[]
```

Return `chrome` then `edge` in fixed order:

```json
{
  "id": "chrome",
  "name": "Google Chrome",
  "available": true,
  "resolvedPath": "C:/Program Files/Google/Chrome/Application/chrome.exe"
}
```

Requirements:

- `available` is exactly `resolvedPath !== null`.
- Return canonical forward-slashed paths.
- Run blocking registry/filesystem work through `spawn_blocking`.
- Use deterministic Windows lookup order:
  1. App Paths under HKCU
  2. App Paths under HKLM, including relevant 64-bit and 32-bit views
  3. standard LocalAppData and Program Files locations
  4. GUI-safe PATH fallback
- Chrome candidates must be regular `chrome.exe` files.
- Edge candidates must be regular `msedge.exe` files.
- Ignore stale registry values and directories.
- Never execute a browser or inspect its version/authentication.
- Tests must inject readers/resolvers and not depend on host browsers.

Standard locations:

```text
Chrome:
  %LOCALAPPDATA%\Google\Chrome\Application\chrome.exe
  %PROGRAMFILES%\Google\Chrome\Application\chrome.exe
  %PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe

Edge:
  %PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe
  %PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe
  %LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe
```

## Command 2: Executable Validation

Add a camelCase DTO and command:

```text
browser_validate_executable(request: BrowserExecutableRequest)
  -> BrowserExecutable
```

Request and response:

```json
{ "browserId": "chrome", "path": "C:/Portable/Chrome/chrome.exe" }
```

Requirements:

- Browser ID is exactly `chrome` or `edge`.
- Path is non-empty, absolute, canonical, existing, and a regular file.
- Windows extension is `.exe`.
- Canonical basename matches the selected browser.
- Return canonical forward-slashed `path` and `browserId` only.
- Do not accept arguments or launch the executable.

## Command 3: Managed Profile Status

Add:

```text
browser_profile_status(request: BrowserProfileRequest)
  -> BrowserProfileStatus
```

Request:

```json
{ "browserId": "chrome", "profileId": "bp-018f5b8a" }
```

Response:

```json
{
  "browserId": "chrome",
  "profileId": "bp-018f5b8a",
  "profilePath": "C:/Users/Admin/AppData/Local/app.afflow.desktop/browser-profiles/chrome/bp-018f5b8a/user-data",
  "exists": true,
  "activity": "idle"
}
```

`activity` is `active`, `idle`, or `unknown`.

Profile requirements:

- IDs match `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`.
- Reject dots, separators, drive prefixes, traversal, whitespace, Unicode,
  reserved path components, and overlength values.
- Derive paths only under the native managed base.
- New containers get `.afflow-profile.json` with exactly `schemaVersion`,
  `browserId`, `profileId`, and `createdAt`.
- Do not adopt a pre-existing unmarked directory.
- A marker must match the requested browser/profile IDs.
- Reject symlink, junction, or reparse-point escapes in the browser/profile
  container or `user-data`.
- Canonical containment under the app-local profile base is mandatory.
- Status is read-only. A missing container returns `exists: false`, the
  derived path, and `activity: idle`; it does not create directories or a
  marker. Launch and folder-open are the commands allowed to create a marked
  container.

Windows activity requirements:

- A live child tracked by native state means `active`.
- Probe Chromium's `user-data/lockfile` with Windows sharing semantics.
- A sharing violation means `active`.
- A missing lockfile with no live child means `idle`.
- Permission denial, unexpected I/O, or ambiguity means `unknown`.
- Child PID state alone is not proof of idle because Chromium can forward a
  launch and Afflow may restart while the browser remains open.

## Command 4: Structured Browser Launch

Add:

```text
browser_launch(request: BrowserLaunchRequest) -> BrowserLaunchResult
```

Request:

```json
{
  "browserId": "chrome",
  "executablePath": null,
  "profileId": "bp-018f5b8a",
  "urls": [
    "https://labs.google/fx/tools/flow",
    "https://klingai.com/"
  ]
}
```

Response:

```json
{
  "browserId": "chrome",
  "executablePath": "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "profileId": "bp-018f5b8a",
  "profilePath": "C:/Users/Admin/AppData/Local/app.afflow.desktop/browser-profiles/chrome/bp-018f5b8a/user-data",
  "pid": 1234,
  "launchedUrlCount": 2
}
```

Requirements:

- Null executable resolves the selected installed browser natively.
- A non-null override is revalidated with Command 2 rules.
- Require 1 to 16 URLs, each at most 2048 UTF-8 bytes, with total input at
  most 16384 bytes.
- Parse via `tauri::Url` or `reqwest::Url`.
- Allow absolute HTTP/HTTPS only. Reject credentials, control characters,
  invalid ports, malformed values, and unsupported schemes.
- Preserve URL order.
- Ensure and validate the managed marker before launch.
- Serialize launch/reset for the same browser/profile key.
- Build this structured plan with separate `.arg` calls:

  ```text
  <validated executable>
  --user-data-dir=<native-derived absolute user-data path>
  --new-window
  <url 1>
  <url 2>
  ...
  ```

- Fixed backend-only Chromium flags may be added. Never accept flags from JS.
- Never use `cmd /c start`, PowerShell, a shell string, the default URL opener,
  or `file://`.
- Null stdio and call `proc::hide_console`.
- Do not attach to Afflow's kill-on-close Job Object.
- Track the returned `Child` in `BrowserState` and prune with `try_wait`, but
  never kill it on drop or app exit.
- Do not log complete URLs, query strings, auth URLs, or browser output.

## Command 5: Open Managed Profile Folder

Add:

```text
browser_profile_open_folder(request: BrowserProfileRequest)
  -> BrowserProfileLocation
```

Return `browserId`, `profileId`, and canonical forward-slashed `profilePath`.

Requirements:

- Validate or safely create the managed marker first.
- Open only the native-derived container or `user-data` folder.
- Do not accept a path from the frontend.
- Return a clear OS opener error.
- Do not launch Chrome/Edge or inspect profile contents.

## Command 6: Confirmed Profile Reset

Add:

```text
browser_profile_reset(request: BrowserProfileResetRequest)
  -> BrowserProfileResetResult
```

Request:

```json
{ "browserId": "chrome", "profileId": "bp-018f5b8a", "confirmed": true }
```

Response:

```json
{
  "browserId": "chrome",
  "profileId": "bp-018f5b8a",
  "profilePath": "C:/Users/Admin/AppData/Local/app.afflow.desktop/browser-profiles/chrome/bp-018f5b8a/user-data",
  "reset": true,
  "cleanupPending": false
}
```

Requirements:

- Reject unless `confirmed` is true.
- Hold the per-profile operation lock through activity check and reset.
- Require a matching Afflow marker.
- Refuse `active` or `unknown` with a user-facing close-browser error.
- Revalidate containment and reparse-point safety immediately before mutation.
- Never kill a browser.
- Never delete the container, marker, sibling browser family, shared profile,
  or another workstation profile.
- Missing `user-data` is idempotent success.
- Atomically rename `user-data` to a generated quarantine sibling before
  recursive deletion. Rename failure leaves the original untouched.
- Roll back the rename if creation of the future clean state fails.
- If quarantine deletion fails after logical reset, return
  `cleanupPending: true`; do not claim old data was deleted.
- Never follow links during recursive cleanup.

## Browser State

Register one native `BrowserState` in `lib.rs` with:

- Per `(browserId, profileId)` operation serialization.
- Tracked `Child` handles for launches in the current Afflow process.
- `try_wait` pruning without killing browsers.
- No credentials, cookies, URLs, browser output, or profile contents.

Do not persist `BrowserState`.

## Claude File Boundary

Claude may touch only:

- New `src-tauri/src/modules/browser.rs` or browser module directory
- `src-tauri/src/modules/mod.rs` for one export
- `src-tauri/src/lib.rs` for import, managed state, and commands
- `src-tauri/Cargo.toml` and `Cargo.lock` only for narrowly required
  `windows-sys` registry/filesystem features
- Existing process or environment visibility only if minimally required to
  reuse `hide_console` or GUI-safe PATH lookup

Do not edit:

- `src/**`
- `src-tauri/src/modules/agent_presets.rs`
- `src-tauri/src/modules/workstation/**`
- Phase 1 or Phase 2 DTOs
- PTY, shell, control, agent-hook, or workspace behavior
- `PROJECT.md`, `TERAX.md`, or this handoff file
- unrelated package manifests

## Required Rust Tests

### Detection and executable validation

- Fixed Chrome then Edge ordering
- Chrome only, Edge only, both, and neither
- HKCU, HKLM views, standard-location, and PATH precedence
- Stale registry entry falls through
- Directory and wrong basename ignored/rejected
- Valid Chrome and Edge overrides
- Blank, relative, missing, directory, wrong extension, and wrong-browser paths
- Canonical forward-slashed result
- Moved override fails again at launch

### Profile derivation and ownership

- Valid shared and workstation IDs
- Traversal, separators, dots, drive prefixes, whitespace, Unicode, reserved,
  and overlength IDs rejected
- Same browser/profile pair stable
- Chrome and Edge with same ID separate
- Two workstation IDs never collide
- Paths remain under a temp app-data base
- Matching marker accepted
- Unmarked, mismatched, malformed, and extra-field markers rejected
- Symlink and genuine Windows junction/reparse escapes rejected

### URL validation and launch planning

- HTTP/HTTPS accepted and order preserved
- Empty/excessive list rejected
- Malformed, unsupported, credentialed, control, flag-like, overlength, and
  excessive-total inputs rejected
- Exact plan has separate args and managed `--user-data-dir`
- No shell or caller flags
- Same profile reuses path; different IDs/families stay isolated
- Spawn errors are readable and do not expose URLs
- Exact camelCase response keys with no command line, contents, or credentials

### Activity and reset

- Live child active; completed child pruned
- Sharing violation active; missing lockfile idle; unexpected errors unknown
- Missing confirmation rejected
- Active/unknown reset rejected
- Missing `user-data` idempotent
- Successful reset preserves marker and siblings byte for byte
- Reset never crosses browser family or managed base
- Rename failure leaves original intact
- Cleanup failure returns `cleanupPending: true`
- Same-profile launch/reset serialized; different profiles independent

Tests must inject registry, environment, filesystem, activity, and spawn
dependencies where appropriate. Run genuine filesystem and Windows junction
tests for the security boundary.

## Codex Work Planned In Parallel

### Codex Agent A: Browser Domain and Persistence

Owns new browser domain files plus Spaces store/useSpaces changes and tests:

- Browser/tool/profile types and normalization
- Spaces schema version 3 migration
- Stable isolated profile IDs and default isolated mode
- Ordered website presets
- Tool add/update/remove/reorder/reset mutations
- Shared/isolated mode preserving the isolated ID
- Malformed data and future-version protection

### Codex Agent B: Browser Tool Launcher UI

Owns new components under `src/modules/browser-tools/components/`:

- Compact launcher for all or one saved tool
- Shared/workstation segmented control
- Add, edit, reorder, and remove tools
- Profile folder and confirmed reset
- Missing/moved browser, active profile, launch failure, empty, loading, and
  success states
- Accessible keyboard/focus behavior and component tests

### Codex Agent C: Global Browser Settings

Owns global browser preferences and a new browser settings section:

- Preferred Chrome/Edge
- Detection status
- Executable picker, native validation, clear override, moved-path handling
- No arbitrary arguments or normal-profile selection

### Lead Codex Agent

Owns barrels, native TypeScript wrappers, Header/NewTabMenu/App integration,
error mapping, docs, full gates, Windows manual verification, combined commit,
and push.

## Frontend Persistence Contract

Claude does not implement this, but native DTOs must remain compatible.

```ts
type BrowserId = "chrome" | "edge";
type BrowserTool = { id: string; name: string; url: string };
type WorkstationBrowserState = {
  profileMode: "workstation" | "shared";
  profileId: string;
  tools: BrowserTool[];
  openOnWorkstationLaunch: boolean;
};
```

Global preferences own:

```ts
type BrowserPreferences = {
  preferredBrowserId: BrowserId;
  browserExecutableOverrides: Partial<Record<BrowserId, string>>;
};
```

The frontend uses `shared-v1` at launch in shared mode without overwriting the
isolated `profileId`. Initial tools are Google Flow, Kling, Grok, TikTok,
Shopee, and Facebook. Rust does not special-case tool brands.

## Integration Contracts

- Detection IDs match frontend `BrowserId` exactly.
- Request DTOs use `#[serde(rename_all = "camelCase")]`.
- Responses serialize camelCase with no extra fields.
- Returned paths are canonical forward-slashed strings.
- Errors are direct, readable, safe for display, and do not expose URL secrets.
- Native code revalidates executable, profile ID, marker, URL, containment,
  activity, and confirmation at every command boundary.
- No profile path, user-data path, argument vector, or command string comes
  from frontend persistence.
- No credentials, tokens, cookies, query strings, browser output, profile
  contents, or process handles are returned, persisted, or logged.
- Existing agent, workstation, terminal, file, and workspace behavior remains
  unchanged.

## Manual MVP Verification

The lead and user perform this after integration:

1. Detect installed Chrome and Edge.
2. Launch at least four saved tools in one normal browser window.
3. Verify `chrome://version` or `edge://version` points inside Afflow app-local
   data, never normal browser User Data.
4. Sign in, restart browser and Afflow, and confirm persistence.
5. Confirm two isolated workstation profiles do not share a session.
6. Confirm shared mode intentionally shares a session across workstations.
7. Upload and download one file on a representative AI site.
8. Exercise pop-up, clipboard, permission, and media behavior.
9. Confirm reset is refused while the managed browser is active.
10. Close it, reset, and verify only the selected managed profile clears.
11. Confirm normal Chrome/Edge User Data directories are not modified.
12. Confirm the external browser remains open when Afflow exits.

## Chromium References

- `https://chromium.googlesource.com/chromium/src/+/main/docs/user_data_dir.md`
- `https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/process_singleton_win.cc`

Chromium documents `--user-data-dir`. Its current Windows ProcessSingleton
creates `lockfile` under that directory with Windows sharing semantics. Keep
the activity probe isolated behind a small platform function so it can change
if Chromium changes.

## Verification Commands

```powershell
& 'C:\Users\Admin\.cargo\bin\cargo.exe' clippy --all-targets --locked -- -D warnings
& 'C:\Users\Admin\.cargo\bin\cargo.exe' test --locked
```

Format only Claude-owned new Rust files. The repo is not globally clean under
the installed rustfmt, so do not run a workspace-wide formatting rewrite. Do
not run frontend formatting commands while other agents have in-flight work.

## Coordination Rules

- Do not commit. The lead creates one combined Phase 3 commit.
- Do not stage unrelated files.
- Do not revert or reformat another agent's changes.
- Inspect current diffs before touching shared Rust registration/Cargo files.
- Prefer existing dependencies and narrow `windows-sys` features. Report
  before adding a new crate.
- If a DTO or frozen rule must change, stop and report the exact reason.
- Remain available for review fixes.

## Required Return Report

Return:

1. Exact files changed
2. DTO and response shapes
3. Detection order and executable validation
4. Profile path, marker, containment, and activity behavior
5. Exact launch arguments
6. Reset and partial-cleanup behavior
7. Tests and exact results
8. Clippy and full Cargo results
9. Known limitations and risks
10. Lead integration steps
11. Confirmation no frontend files were touched
12. Confirmation nothing was committed

## Phase 3 Acceptance Checklist

- Chrome and Edge detection is accurate on the Windows target.
- Invalid/moved overrides fail clearly.
- Each workstation has ordered tools and an isolated profile ID.
- Shared mode is logical but Chrome/Edge data stays separate.
- Four or more tools launch in one external browser window.
- Launch always uses Afflow app-local `--user-data-dir`.
- No launch can fall back to the normal browser profile.
- Tool order and browser/profile selection persist.
- Sign-in persists after browser and Afflow restart.
- Two isolated profiles do not share cookies/sessions.
- Shared mode intentionally shares its session.
- Upload/download works on a representative AI site.
- Profile folder open targets only the selected managed profile.
- Reset confirms, refuses active/unknown, and clears only selected user data.
- Browser processes survive Afflow exit.
- No credentials, cookies, auth storage, sensitive URLs, profile contents, or
  process handles are persisted/logged.
- Phase 1/2 workflows and schema data remain intact.
- Frontend type-check/tests/build/lint, strict Clippy, full Rust tests, and
  native Windows manual verification pass.

## Scope Traps

- Do not embed websites or automate them.
- Do not use the default browser opener for managed launch.
- Do not use `--profile-directory` against normal User Data.
- Do not accept flags, command strings, profile paths, or user-data paths.
- Do not share Chrome and Edge data or copy profile contents.
- Do not inspect cookies, pages, tabs, local storage, passwords, or tokens.
- Do not delete profiles during workstation archive/rename.
- Do not auto-launch during hydration or React rerenders.
- Do not trust only the spawned PID for reset safety.
- Do not kill the browser to make reset succeed.
- Do not expand into packaging, crash recovery, product records, or Phase 5.
