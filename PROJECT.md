# Afflow

> A desktop production workspace that coordinates files, terminal agents, and workspace-specific browser profiles for TikTok, Shopee, and Facebook affiliate content.

## 1. Project Summary

Afflow is a desktop application built for creators who currently switch between file explorers, browsers, AI media tools, agent terminals, and Markdown editors during affiliate-content production.

The application combines these tools into persistent, niche-specific workstations:

- A file organizer for product research, scripts, images, videos, and outputs
- A browser launcher that opens external AI and affiliate platforms in a normal Chrome or Edge window with a shared or workstation-specific profile
- Terminal-based AI agents that use the creator's existing subscriptions
- Reusable Markdown prompts for specialized agents
- Saved workstations that restore their files, website launchers, browser-profile choice, terminals, and layout

The first version is a focused personal production tool—not a scraper, social-media bot, or fully automated posting system.

## 2. Product Vision

Build **“Terax, redesigned specifically for AI affiliate content creation.”**

The app should let a creator coordinate this workflow from one persistent workspace, using a dedicated browser window for external websites:

```text
Discover product
  → save references
  → research product and audience
  → generate scripts
  → review scripts for platform risk
  → generate image/video prompts
  → use AI media websites
  → organize generated assets
  → export the final content package
```

## 3. Recommended Foundation

Start from a maintained fork of Terax instead of rebuilding terminal emulation, PTY management, file browsing, panes, editors, and workspace persistence from zero.

Expected stack:

- Tauri desktop shell
- Rust native layer
- React and TypeScript frontend
- xterm.js terminal UI
- CodeMirror or the editor already used by the base project
- Operating-system process APIs for launching Chrome or Edge with Afflow-managed profiles
- Local JSON initially; SQLite when product records become necessary

Before changing code:

1. Fork and clone the chosen Terax repository.
2. Run the unmodified application successfully.
3. Document its existing tab, pane, terminal, preview, and persistence models.
4. Preserve upstream license notices and record modifications.
5. Create a feature branch for Afflow changes.

## 4. Target User

An AI affiliate creator who:

- Promotes products on TikTok, Shopee, and Facebook
- Uses several browser-based AI image/video tools
- Uses Claude Code, Codex CLI, Gemini CLI, OpenCode, or similar terminal agents
- Produces content for multiple niches
- Wants each niche to retain its own files, website presets, optional browser profile, terminals, and layout
- Prefers bring-your-own-subscription tools over a new paid AI backend

## 5. MVP Goals

The MVP succeeds when the user can:

1. Create and switch between niche workstations.
2. Browse and manage files within the active workstation.
3. Launch several external websites in a normal Chrome or Edge window using the configured Afflow browser profile.
4. Stay signed in through that browser profile after restarting Afflow, subject to each website's own session rules.
5. Open four named terminal-agent presets.
6. Configure three specialized agents with `prompt.md` files.
7. Drag or reference files from the explorer in an agent terminal.
8. Restart the app and restore the last workstation, saved website launchers, browser-profile selection, terminal definitions, and layout.

## 6. Non-Goals for V1

Do not build these yet:

- Automated posting to TikTok, Shopee, or Facebook
- Automated purchasing, checkout, messaging, or account actions
- Credential storage outside normal browser profiles and agent CLIs
- TikTok or Shopee scraping that bypasses access controls
- CAPTCHA solving or anti-bot evasion
- A proprietary AI-agent backend
- Multi-user collaboration or cloud synchronization
- Revenue analytics and attribution
- Full video editing
- Automated medical or disease-treatment claims
- A public plugin marketplace
- An embedded general-purpose web browser
- Reading, copying, exporting, or synchronizing browser cookies and authentication data

## 7. Core Experience

### 7.1 Main Layout

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Afflow                           Workstation: 3D Humanoid       ⚙   │
├───────────────┬──────────────────────────┬───────────────────────────┤
│ WORKSTATIONS  │ FILES / EDITOR           │ WEB TOOLS                 │
│               │                          │                           │
│ Dashboard     │ products/                │ Chrome · 3D Humanoid       │
│ 3D Humanoid   │ references/              │                           │
│ Fit Check     │ scripts/                 │ [Open Browser]             │
│ Realistic AI  │ images/                  │ [Flow] [Grok] [Kling] [+] │
│ Other         │ videos/                  │                           │
│ + New         │ outputs/                 │                           │
├───────────────┴──────────────────────────┴───────────────────────────┤
│ AGENTS                                                               │
│ [General] [Script Generator] [Script Reviewer] [Video Prompt]        │
│ ┌────────────────────────────┬──────────────────────────────────────┐ │
│ │ terminal pane              │ terminal pane                        │ │
│ └────────────────────────────┴──────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

The layout may be resized and rearranged. Each workstation remembers its own layout.

### 7.2 Initial Workstations

#### 3D Humanoid

- Intended for health, beauty, household, and problem/solution products
- Default tools: files, browser launcher, General Agent
- Optional specialized agents can be opened as needed

#### Fit Check

- Intended for clothing, fashion, shoes, accessories, and outfit content
- Default tools: files, browser launcher, General Agent

#### Realistic AI Human

- Intended for content aimed at older audiences and general wellness/household products
- Default tools: files, browser launcher, General Agent
- Script Reviewer should be prominent for health and wellness content

#### Other Niches

- User-created workstations based on the same template
- Custom name, icon, color, default websites, and default agents

Health-related content must not automatically claim that a product diagnoses, treats, cures, reverses, or prevents a disease. The reviewer should flag risky claims rather than silently approve or rewrite them as facts.

## 8. Functional Requirements

### 8.1 Workstation Manager

Each workstation stores:

- Unique ID
- Name, icon, and optional accent color
- Root directory
- Pane layout
- Open editor/file tabs
- Browser-profile mode and saved website launchers
- Agent terminal definitions
- Tool presets
- Last-opened timestamp

Required actions:

- Create workstation
- Open workstation
- Rename workstation
- Duplicate workstation configuration
- Archive workstation
- Restore the last active workstation at startup

Duplicating a workstation must create a fresh isolated browser profile when the source uses workstation isolation; it must never copy cookies or other browser-profile contents. Archiving or deleting a workstation must not delete its external files or Afflow-managed browser profile by default. Profile removal is a separate confirmed action.

### 8.2 File Organizer

Required features:

- Tree-based file explorer
- Create, rename, move, duplicate, and archive files/folders
- Drag and drop within the explorer
- Drag files into supported app panels
- Copy absolute and workspace-relative paths
- Markdown editing and preview
- Image preview
- Audio/video preview where supported by the existing app
- Open folder in the operating system
- Reveal file in explorer

Default workstation structure:

```text
<workstation>/
├── agents/
│   ├── script-generator/
│   │   └── prompt.md
│   ├── script-reviewer/
│   │   └── prompt.md
│   └── video-prompt/
│       └── prompt.md
├── products/
├── references/
├── research/
├── scripts/
├── images/
├── audio/
├── videos/
├── outputs/
└── workstation.json
```

### 8.3 Browser Launcher and Profiles

External websites must open in a normal installed browser rather than an iframe or embedded webview. Chrome and Edge are the initially supported browsers.

MVP browser-launcher requirements:

- Detect installed Chrome and Edge executables on Windows
- Allow the user to select a preferred browser
- Use an isolated browser profile per workstation by default, with one shared Afflow profile available as an explicit option
- Store Afflow-managed profile data under the app-specific local data directory, using stable paths derived from internal profile IDs rather than workstation names
- Never reuse, modify, or launch the user's normal default browser profile as an Afflow-managed profile
- Launch browser arguments through a structured process API rather than a shell command string
- Open a dedicated browser window with one or more saved website URLs
- Add, rename, reorder, and remove saved website launchers per workstation
- Allow a user-defined browser executable after explicit selection and validation
- Show clear errors when the configured browser is missing, blocked, or cannot create its profile
- Provide actions to open the profile folder and reset an Afflow-managed profile
- Require the related browser instance to be closed and confirmation to be given before resetting a profile
- Let the normal browser own tabs, navigation, authentication, uploads, downloads, pop-ups, permissions, extensions, and media playback

Afflow persists browser configuration and saved URLs, but it does not inspect or promise to restore the browser's exact live tab state. Session and tab restoration inside the browser remain subject to that browser's settings and each website's behavior.

Initial website presets:

- AI video tools: Google Flow, Kling, Grok, and user-defined tools
- Product research: TikTok, Shopee, Facebook, and user-defined spy tools

Do not automate these websites, inspect their page contents, intercept authentication, or attempt to transfer cookies between profiles.

### 8.4 Agent Terminals

Agents run through local terminal commands and the user's existing CLI subscriptions.

Supported concept:

- Claude Code
- Codex CLI
- Gemini CLI
- OpenCode
- Custom shell command

Never hard-code credentials or copy authentication tokens. Authentication remains owned by each CLI.

#### Agent 1: General Agent

- No injected project-specific prompt
- Starts the selected CLI in the active workstation directory
- Suitable for general research, file work, planning, and development

#### Agent 2: Script Generator

- Reads `agents/script-generator/prompt.md`
- Accepts product research, audience notes, references, and requested platform
- Writes drafts to `scripts/`
- Must distinguish verified product facts from creative framing

#### Agent 3: Script Reviewer

- Reads `agents/script-reviewer/prompt.md`
- Reviews a script for content and advertising risk
- Flags risky medical claims, guarantees, misleading urgency, unsupported comparisons, before/after claims, and platform-sensitive wording
- Produces a review report and suggested revisions
- Does not present its review as legal advice or guarantee platform approval

#### Agent 4: Image-to-Video Prompt Generator

- Reads `agents/video-prompt/prompt.md`
- Accepts an image plus script or scene description
- Produces tool-specific prompts for selected AI media tools
- Saves prompts as Markdown under the related product or `outputs/`

### 8.5 Agent Launcher Configuration

Use a configurable model rather than hard-coded CLI commands:

```json
{
  "id": "script-generator",
  "name": "Script Generator",
  "command": "codex",
  "args": [],
  "workingDirectory": "${workstationRoot}",
  "promptFile": "agents/script-generator/prompt.md",
  "autoStart": false
}
```

The implementation should adapt the prompt-loading mechanism to each CLI. If a CLI cannot accept startup text safely, start it normally and expose a one-click **Copy startup instruction** action.

### 8.6 Persistence

Persist at minimum:

- App window size and position
- Active workstation
- Pane sizes and arrangement
- Open files/editor tabs
- Preferred browser and shared-profile settings
- Per-workstation browser-profile mode and saved website launchers
- Agent preset definitions
- Terminal working directories

V1 does not need to restore the live internal state of every terminal process. It may recreate the configured terminal tabs after restart and clearly mark them as new sessions.

## 9. Suggested Data Models

```ts
type Workstation = {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  rootPath: string;
  layout: LayoutState;
  editorTabs: EditorTabState[];
  browser: WorkstationBrowserState;
  agentPresets: AgentPreset[];
  createdAt: string;
  updatedAt: string;
};

type WorkstationBrowserState = {
  profileMode: "shared" | "workstation";
  profileId: string;
  tools: BrowserTool[];
  openOnWorkstationLaunch: boolean;
};

type BrowserTool = {
  id: string;
  name: string;
  url: string;
};

type AgentPreset = {
  id: string;
  name: string;
  command: string;
  args: string[];
  workingDirectory: string;
  promptFile?: string;
  autoStart: boolean;
};
```

Start with local JSON if that matches the base application. Migrate to SQLite only when products, searches, statuses, and relationships require structured querying.

## 10. State Boundaries

Use clear separation between:

- **Global app state:** settings, theme, available CLI definitions, preferred browser, shared Afflow browser profile
- **Workstation state:** layout, saved website launchers, browser-profile selection, editor tabs, agent presets
- **Filesystem content:** prompts, research, scripts, images, videos, outputs
- **Ephemeral runtime state:** running terminal processes, browser launch status, loading indicators, native process handles

Never store browser or PTY process handles, secrets, cookies, or access tokens in `workstation.json`.

## 11. Starter Agent Prompts

These are starting points. Store them as separate `prompt.md` files when scaffolding a workstation.

### 11.1 Script Generator Prompt

```md
# Role

You are an affiliate short-form video script writer.

# Objective

Create compelling, platform-appropriate scripts from the product information and audience notes provided by the user.

# Rules

- Never invent product specifications, prices, discounts, certifications, reviews, or health outcomes.
- Clearly label assumptions and missing information.
- Do not claim that supplements or products diagnose, treat, cure, reverse, or prevent diseases unless the user supplies reliable, legally usable substantiation and explicitly requests compliant wording.
- Avoid guaranteed results, fake scarcity, impersonation, and misleading before/after claims.
- Match the requested platform, niche, audience, duration, language, and tone.
- Use natural Filipino English or Taglish when requested.

# Default Output

1. Hook
2. Scene-by-scene script
3. On-screen text
4. Voice-over
5. Call to action
6. Product facts used
7. Claims requiring verification
```

### 11.2 Script Reviewer Prompt

```md
# Role

You are a conservative affiliate-content risk reviewer.

# Objective

Review the supplied script before production. Identify possible platform-policy, advertising, consumer-protection, and credibility risks. This review is not legal advice and does not guarantee approval by any platform.

# Review Categories

- Unsupported factual claim
- Medical or disease-treatment claim
- Guaranteed result or exaggerated promise
- Misleading price, discount, testimonial, or scarcity
- Before/after or body-image risk
- Missing disclosure or unclear affiliate relationship
- Unsafe instruction
- Copyright, trademark, or impersonation concern
- Platform-sensitive language

# Output

- Overall risk: LOW / MEDIUM / HIGH / DO NOT PUBLISH
- Findings table: exact line, issue, reason, severity
- Required revisions
- Safer suggested version
- Facts or evidence the creator must verify

Do not silently remove the commercial meaning of the script. Explain every material change.
```

### 11.3 Video Prompt Generator Prompt

```md
# Role

You create production-ready image-to-video prompts for AI media tools.

# Inputs

- Source image or image path
- Script or scene description
- Target tool
- Desired duration and aspect ratio
- Niche and audience

# Rules

- Preserve the identity, product design, clothing, and important source-image details unless instructed otherwise.
- Describe subject motion, camera movement, environment motion, timing, lighting, and continuity.
- Avoid impossible simultaneous actions and unnecessary scene changes.
- Do not add text, logos, people, or product claims unless requested.
- Keep prompts tool-specific and concise.

# Output

1. Main prompt
2. Negative prompt, if supported
3. Camera and motion notes
4. Continuity risks
5. Alternate conservative prompt
```

## 12. Security and Privacy Requirements

- Use operating-system-safe APIs for file operations.
- Canonicalize paths and prevent workstation-relative operations from escaping the configured root without explicit user action.
- Never log passwords, cookies, tokens, prompt contents marked private, or authentication URLs containing secrets.
- Keep Afflow-managed browser data in an app-specific local profile directory.
- Never read, copy, export, log, or synchronize browser cookies, local storage, passwords, or authentication tokens.
- Never modify or delete the user's normal Chrome or Edge profile.
- Validate the selected browser executable and pass arguments without shell-string interpolation.
- Confirm destructive filesystem actions.
- Treat downloaded files as untrusted.
- Do not bypass website access controls or automate prohibited actions.
- Close the related browser instance and confirm with the user before resetting an Afflow-managed browser profile.

## 13. Accessibility and UX Requirements

- Full keyboard navigation for primary tabs and panes
- Visible focus states
- Accessible labels for icon-only buttons
- User-adjustable terminal and editor font sizes
- Dark theme as the initial visual direction
- High contrast between the active and inactive workstation/tab
- Clear missing-browser, launch-failed, profile-locked, and profile-reset states
- Confirmation before closing a terminal with an active process
- Recovery message after an unclean shutdown

## 14. Build Phases

### Phase 0: Baseline the Fork

- Run the base app on Windows
- Identify the existing state store and tab/pane types
- Document how PTYs, filesystem access, preview webviews, and restoration work
- Add the Afflow name, app ID, and development branding
- Keep the app working after the rename

**Exit criterion:** the renamed fork builds and runs with all original core behavior intact.

### Phase 1: Workstations and File Templates

- Add workstation sidebar
- Add create/open/rename/archive actions
- Generate the default folder and prompt structure
- Save and restore workstation layout
- Switch the active filesystem root when workstations change

**Exit criterion:** switching workstations changes the file tree and restores the correct layout without losing state.

### Phase 2: Agent Presets

- Add the four default agent types
- Allow CLI selection and custom command configuration
- Start terminals in the workstation root
- Load or expose the relevant `prompt.md`
- Add one-click opening of referenced output files

**Exit criterion:** all four presets launch successfully using at least one installed CLI.

### Phase 3: Browser Profiles and Tool Launchers

- Detect installed Chrome and Edge executables
- Add preferred-browser configuration
- Add shared and per-workstation Afflow profile modes
- Add saved website tool presets and custom URLs
- Launch the selected browser, profile, and URLs through a structured native command
- Add profile-folder and confirmed profile-reset actions
- Test the actual target sites manually in the launched browser

**Exit criterion:** each workstation launches the correct normal browser profile and saved websites, sign-ins persist, isolated profiles do not share sessions, and a manual upload/download workflow succeeds on a representative AI media site.

### Phase 4: Daily-Driver Hardening

- Crash recovery
- Browser launch and profile-lock recovery
- Confirmed Afflow browser-profile reset
- Keyboard shortcuts
- Unsaved file protection
- Packaging and Windows installer
- Performance testing with multiple terminals and repeated browser launches

**Exit criterion:** the app and its launched browser profile can complete a product-to-video-prompt session without losing workstation context.

### Phase 5: Product Workspace (After MVP)

Only after the base workflow is stable:

- Add product records and production statuses
- Link research, scripts, images, and videos to a product
- Add saved product URLs
- Add script-review status
- Add production checklist and export package

Possible status flow:

```text
Saved → Researching → Scripting → Review → Generating → Editing → Ready → Published
```

## 15. Initial Development Backlog

### P0 — Must Have

- [ ] Fork and run the base project
- [ ] Rename app and package identifiers safely
- [ ] Locate and document tab, pane, PTY, file, preview, and state modules
- [ ] Add workstation schema and persistence
- [ ] Add workstation switcher/sidebar
- [ ] Add workstation scaffolding command
- [ ] Add default prompt templates
- [ ] Add configurable agent presets
- [ ] Detect installed Chrome and Edge browsers
- [ ] Add shared and per-workstation Afflow browser profiles
- [ ] Add saved website launchers and structured browser launching
- [ ] Restore the last active workstation
- [ ] Package a Windows development build

### P1 — Should Have

- [ ] Browser and agent tool presets
- [ ] Duplicate workstation
- [ ] Drag file path into terminals
- [ ] Browser executable override and validation
- [ ] Crash/unclean-shutdown recovery
- [ ] Confirmed Afflow browser-profile reset
- [ ] Config export/import without credentials
- [ ] Keyboard shortcuts

### P2 — Later

- [ ] Product records
- [ ] Production pipeline/status board
- [ ] Search across scripts and research
- [ ] Local content index
- [ ] Export content package
- [ ] Optional local automation/orchestration
- [ ] Analytics integrations through official APIs

## 16. Testing Matrix

### Desktop

- Windows 11 is the first supported platform
- Other platforms are best effort until deliberately tested

### Browser Launcher Test Cases

- Detect installed Chrome and Edge correctly
- Handle a missing or moved configured executable
- Launch URLs in a dedicated normal browser window
- Reuse the correct Afflow-managed profile on later launches
- Preserve sign-ins after Afflow and the browser restart
- Keep two workstation-specific profiles isolated from each other
- Reuse one shared profile across workstations when configured
- Duplicate a workstation without copying its isolated browser-profile contents
- Open every saved website preset with the expected URL
- Complete file upload, download, pop-up, clipboard, and media workflows in the normal browser
- Refuse to reset a profile while its related browser instance is active
- Never modify the user's normal browser profile

### Workspace Test Cases

- Create two workstations with different roots
- Open different files, browser profiles/tool presets, and agents in each
- Switch repeatedly without cross-contaminating state
- Restart and verify restoration
- Rename/archive a workstation
- Recover from a missing or moved root folder

### Terminal Test Cases

- Launch configured CLI
- Handle missing executable
- Handle authentication-required state
- Preserve correct working directory
- Resize terminal panes
- Warn before closing a live process
- Restart configuration after application relaunch

## 17. MVP Acceptance Criteria

The MVP is complete only when all of the following are true:

- [ ] At least three separate niche workstations can be created and restored.
- [ ] Each workstation has an independent file root and layout.
- [ ] Markdown, image, and video assets can be opened from the file tree.
- [ ] Four named agent presets are available.
- [ ] Specialized agents reference their own configurable prompt files.
- [ ] At least one supported AI CLI can run in every agent terminal.
- [ ] At least four configured websites can launch in a dedicated normal browser window.
- [ ] Shared and per-workstation Afflow browser-profile modes are available.
- [ ] Sign-ins persist in the selected browser profile after Afflow and browser restarts.
- [ ] Two isolated workstation profiles do not share cookies or login sessions.
- [ ] File upload and download work on at least one representative AI media website in the launched browser.
- [ ] The user's normal Chrome or Edge profile is never modified by Afflow.
- [ ] No credentials are stored in workstation configuration files.
- [ ] A packaged Windows build completes one real affiliate-content workflow.

## 18. Architecture Decisions to Resolve Early

Record the answers as architecture decision records before major implementation:

1. Which Chrome and Edge install locations and browser-selection overrides are supported on Windows?
2. How should the optional shared profile behave when a workstation is duplicated, archived, or restored?
3. How are Afflow-managed profile directories named, located, locked, and safely reset?
4. Which saved URLs should launch automatically without inspecting or controlling the browser's live tabs?
5. How does each supported CLI receive the prompt file without fragile shell escaping?
6. Which state belongs in the base app's existing store versus `workstation.json`?
7. How will the app respond when a workstation root is moved or unavailable?
8. Which upstream changes should remain easy to merge from Terax?

## 19. Guardrails for Coding Agents

Use these rules when asking Codex, Claude Code, or another agent to implement the project:

- Read this entire file before making changes.
- Inspect the existing implementation before proposing a replacement.
- Reuse the base project's patterns and dependencies where practical.
- Work on one phase and one testable slice at a time.
- Do not rewrite unrelated modules.
- Do not add a backend, database, cloud service, or authentication system unless the current task requires it.
- Do not automate third-party websites in the MVP.
- Do not embed external websites, inspect browser contents, or read/copy browser cookies and authentication data.
- Do not launch or modify the user's normal browser profile as an Afflow-managed profile.
- Never commit credentials, cookies, tokens, build secrets, or user browser data.
- Add or update tests with each feature.
- Run formatting, type checks, tests, and the relevant build before declaring completion.
- Report changed files, tests run, remaining risks, and manual verification steps.
- Stop and explain if a proposed change would break upstream licensing, security boundaries, or user data.

## 20. First Agent Task

Use this after cloning the Terax fork:

```text
Read PROJECT.md completely. Do not implement features yet.

Inspect the repository and produce a concise architecture map covering:

1. frontend entry points and routing;
2. tab and pane state models;
3. terminal/PTY lifecycle;
4. filesystem explorer and drag-and-drop behavior;
5. editor and media preview components;
6. existing local webview/URL preview and browser-launch mechanisms;
7. persistence and startup restoration;
8. Tauri commands, permissions, and capabilities;
9. packaging configuration; and
10. the smallest set of modules likely to change for Phase 1.

Create docs/architecture-baseline.md with file references, risks, and a recommended Phase 1 implementation sequence. Do not modify application code during this task. Run only safe, read-only inspection commands.
```

## 21. Definition of the First Usable Release

The first usable release is not the version with the most automation. It is the version that reliably gives the creator one place to:

- choose a niche;
- collect product files and references;
- launch several browser-based AI tools in the correct Afflow-managed browser profile;
- work with four specialized terminal agents;
- review risky scripts before production; and
- reopen Afflow with the correct workstation context and browser tool configuration.

Everything else should wait until this workflow feels fast and dependable in daily use.
