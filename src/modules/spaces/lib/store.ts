import {
  normalizeWorkstationAgentPresets,
  type WorkstationAgentPreset,
} from "@/modules/agents/lib/presets";
import {
  browserProfileIdForWorkstation,
  hasCanonicalWorkstationBrowserState,
  normalizeWorkstationBrowserState,
} from "@/modules/browser-tools/lib/browserState";
import type { WorkstationBrowserState } from "@/modules/browser-tools/lib/types";
import type { WorkspaceEnv } from "@/modules/workspace";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { SerializedTab } from "./serialize";

export type SpaceMeta = {
  id: string;
  name: string;
  root: string | null;
  env: WorkspaceEnv;
  agentPresets: WorkstationAgentPreset[];
  browser: WorkstationBrowserState;
  /** Opt-in accent, index into SPACE_COLORS. Undefined = theme primary. */
  color?: number;
  createdAt: number;
  updatedAt: number;
};

export type SpaceState = {
  tabs: SerializedTab[];
  activeTabIndex: number;
};

export const SPACE_STORE_SCHEMA_VERSION = 3;

const STORE_PATH = "terax-spaces.json";
const KEY_SCHEMA_VERSION = "schemaVersion";
const KEY_SPACES = "spaces";
const KEY_ACTIVE = "activeId";
const STATE_PREFIX = "state:";
const stateKey = (id: string) => `${STATE_PREFIX}${id}`;

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 500 });
let writesAllowed = true;

export type LoadedSpaces = {
  spaces: SpaceMeta[];
  activeId: string | null;
  states: Map<string, SpaceState>;
};

type MigrationResult = {
  spaces: SpaceMeta[];
  needsWrite: boolean;
};

function isWorkspaceEnv(value: unknown): value is WorkspaceEnv {
  if (!value || typeof value !== "object") return false;
  const env = value as Record<string, unknown>;
  return (
    env.kind === "local" ||
    (env.kind === "wsl" &&
      typeof env.distro === "string" &&
      env.distro.length > 0)
  );
}

function migrateSpace(value: unknown): SpaceMeta | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    raw.id.length === 0 ||
    typeof raw.name !== "string" ||
    raw.name.length === 0 ||
    (raw.root !== null && typeof raw.root !== "string") ||
    !isWorkspaceEnv(raw.env) ||
    typeof raw.createdAt !== "number" ||
    !Number.isFinite(raw.createdAt) ||
    typeof raw.updatedAt !== "number" ||
    !Number.isFinite(raw.updatedAt)
  ) {
    return null;
  }
  return {
    id: raw.id,
    name: raw.name,
    root: raw.root,
    env: raw.env,
    agentPresets: normalizeWorkstationAgentPresets(raw.agentPresets),
    browser: normalizeWorkstationBrowserState(
      raw.browser,
      browserProfileIdForWorkstation(raw.id),
    ),
    ...(typeof raw.color === "number" && Number.isInteger(raw.color)
      ? { color: raw.color }
      : {}),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function hasCanonicalPresets(
  value: unknown,
  presets: readonly WorkstationAgentPreset[],
): boolean {
  if (!Array.isArray(value) || value.length !== presets.length) return false;
  return presets.every((preset, index) => {
    const raw = value[index];
    if (!raw || typeof raw !== "object") return false;
    const record = raw as Record<string, unknown>;
    return (
      record.id === preset.id &&
      record.name === preset.name &&
      record.launcherId === preset.launcherId &&
      record.customCommand === preset.customCommand &&
      record.promptFile === preset.promptFile
    );
  });
}

export function migratePersistedSpaces(
  value: unknown,
  storedVersion: unknown,
): MigrationResult {
  const canWrite =
    typeof storedVersion !== "number" ||
    storedVersion <= SPACE_STORE_SCHEMA_VERSION;
  if (!Array.isArray(value)) {
    return {
      spaces: [],
      needsWrite: canWrite && storedVersion !== SPACE_STORE_SCHEMA_VERSION,
    };
  }

  const seen = new Set<string>();
  const spaces: SpaceMeta[] = [];
  const sources: Record<string, unknown>[] = [];
  for (const record of value) {
    const space = migrateSpace(record);
    if (!space || seen.has(space.id)) continue;
    seen.add(space.id);
    spaces.push(space);
    sources.push(record as Record<string, unknown>);
  }
  return {
    spaces,
    needsWrite:
      canWrite &&
      (storedVersion !== SPACE_STORE_SCHEMA_VERSION ||
        spaces.length !== value.length ||
        spaces.some(
          (space, index) =>
            !hasCanonicalPresets(
              sources[index]?.agentPresets,
              space.agentPresets,
            ) ||
            !hasCanonicalWorkstationBrowserState(
              sources[index]?.browser,
              space.browser,
            ),
        )),
  };
}

export async function loadAll(): Promise<LoadedSpaces> {
  const entries = await store.entries();
  let rawSpaces: unknown = [];
  let storedVersion: unknown;
  let activeId: string | null = null;
  const states = new Map<string, SpaceState>();
  for (const [k, v] of entries) {
    if (k === KEY_SCHEMA_VERSION) storedVersion = v;
    else if (k === KEY_SPACES) rawSpaces = v;
    else if (k === KEY_ACTIVE) activeId = typeof v === "string" ? v : null;
    else if (k.startsWith(STATE_PREFIX)) {
      states.set(k.slice(STATE_PREFIX.length), v as SpaceState);
    }
  }
  const migrated = migratePersistedSpaces(rawSpaces, storedVersion);
  writesAllowed =
    typeof storedVersion !== "number" ||
    storedVersion <= SPACE_STORE_SCHEMA_VERSION;
  if (migrated.needsWrite) {
    await saveSpacesList(migrated.spaces);
  }
  return { spaces: migrated.spaces, activeId, states };
}

export async function saveSpacesList(spaces: SpaceMeta[]): Promise<void> {
  if (!writesAllowed) return;
  await store.set(KEY_SPACES, spaces);
  await store.set(KEY_SCHEMA_VERSION, SPACE_STORE_SCHEMA_VERSION);
}

export async function saveActiveId(id: string | null): Promise<void> {
  if (!writesAllowed) return;
  await store.set(KEY_ACTIVE, id);
}

export async function saveState(id: string, state: SpaceState): Promise<void> {
  if (!writesAllowed) return;
  await store.set(stateKey(id), state);
}

export async function deleteSpaceData(id: string): Promise<void> {
  if (!writesAllowed) return;
  await store.delete(stateKey(id));
}

export function newSpaceId(): string {
  return `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
