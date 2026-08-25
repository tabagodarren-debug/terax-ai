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
import { migrateSerializedTabs, type SerializedTab } from "./serialize";

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

export const SPACE_STORE_SCHEMA_VERSION = 4;

const STORE_PATH = "terax-spaces.json";
const KEY_SCHEMA_VERSION = "schemaVersion";
const KEY_SPACES = "spaces";
const KEY_DEVICE_ROOTS = "deviceRoots";
const KEY_ACTIVE = "activeId";
const STATE_PREFIX = "state:";
const stateKey = (id: string) => `${STATE_PREFIX}${id}`;

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 500 });
let writesAllowed = true;
const blockedStatePersistence = new Set<string>();

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

function deviceRootsFrom(value: unknown): Map<string, string> {
  const roots = new Map<string, string>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return roots;
  for (const [id, root] of Object.entries(value as Record<string, unknown>)) {
    if (id.length > 0 && typeof root === "string" && root.trim().length > 0) {
      roots.set(id, root);
    }
  }
  return roots;
}

function migrateSpace(
  value: unknown,
  deviceRoots: ReadonlyMap<string, string>,
): SpaceMeta | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    raw.id.length === 0 ||
    typeof raw.name !== "string" ||
    raw.name.length === 0 ||
    (raw.root !== undefined &&
      raw.root !== null &&
      typeof raw.root !== "string") ||
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
    root:
      deviceRoots.get(raw.id) ??
      (typeof raw.root === "string" && raw.root.trim().length > 0
        ? raw.root
        : null),
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
  rawDeviceRoots?: unknown,
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
  const deviceRoots = deviceRootsFrom(rawDeviceRoots);
  const spaces: SpaceMeta[] = [];
  const sources: Record<string, unknown>[] = [];
  for (const record of value) {
    const space = migrateSpace(record, deviceRoots);
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
            Object.keys(sources[index]).includes("root") ||
            (space.root === null
              ? deviceRoots.has(space.id)
              : deviceRoots.get(space.id) !== space.root) ||
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
  let rawDeviceRoots: unknown;
  let activeId: string | null = null;
  const rawStates = new Map<string, unknown>();
  for (const [k, v] of entries) {
    if (k === KEY_SCHEMA_VERSION) storedVersion = v;
    else if (k === KEY_SPACES) rawSpaces = v;
    else if (k === KEY_DEVICE_ROOTS) rawDeviceRoots = v;
    else if (k === KEY_ACTIVE) activeId = typeof v === "string" ? v : null;
    else if (k.startsWith(STATE_PREFIX)) {
      rawStates.set(k.slice(STATE_PREFIX.length), v);
    }
  }
  const migrated = migratePersistedSpaces(
    rawSpaces,
    storedVersion,
    rawDeviceRoots,
  );
  writesAllowed =
    typeof storedVersion !== "number" ||
    storedVersion <= SPACE_STORE_SCHEMA_VERSION;
  const roots = new Map(migrated.spaces.map((space) => [space.id, space.root]));
  const states = new Map<string, SpaceState>();
  const stateWrites: Array<[string, SpaceState]> = [];
  for (const [id, value] of rawStates) {
    const raw =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    const migratedTabs = migrateSerializedTabs(raw.tabs, roots.get(id) ?? null);
    const oldIndex =
      typeof raw.activeTabIndex === "number" &&
      Number.isInteger(raw.activeTabIndex) &&
      raw.activeTabIndex >= 0
        ? raw.activeTabIndex
        : 0;
    const mappedIndex = migratedTabs.sourceIndexes.indexOf(oldIndex);
    const activeTabIndex =
      mappedIndex >= 0
        ? mappedIndex
        : Math.min(oldIndex, Math.max(0, migratedTabs.tabs.length - 1));
    const state = { tabs: migratedTabs.tabs, activeTabIndex };
    states.set(id, state);
    if (
      migratedTabs.needsWrite ||
      raw.activeTabIndex !== activeTabIndex ||
      Object.keys(raw).some((key) => key !== "tabs" && key !== "activeTabIndex")
    ) {
      stateWrites.push([id, state]);
    }
  }
  for (const [id, state] of stateWrites) await saveState(id, state);
  if (migrated.needsWrite) {
    await saveSpacesList(migrated.spaces);
  }
  return { spaces: migrated.spaces, activeId, states };
}

export async function saveSpacesList(spaces: SpaceMeta[]): Promise<void> {
  if (!writesAllowed) return;
  const deviceRoots = Object.fromEntries(
    spaces.flatMap((space) =>
      space.root === null ? [] : [[space.id, space.root]],
    ),
  );
  const portableSpaces = spaces.map(({ root: _root, ...space }) => space);
  await store.set(KEY_DEVICE_ROOTS, deviceRoots);
  await store.set(KEY_SPACES, portableSpaces);
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

export async function flushStore(): Promise<void> {
  if (!writesAllowed) {
    throw new Error("Spaces store is read-only because it uses a newer schema");
  }
  await store.save();
}

export async function deleteSpaceData(id: string): Promise<void> {
  blockedStatePersistence.delete(id);
  if (!writesAllowed) return;
  await store.delete(stateKey(id));
}

export function setSpaceStatePersistenceBlocked(
  id: string,
  blocked: boolean,
): void {
  if (blocked) blockedStatePersistence.add(id);
  else blockedStatePersistence.delete(id);
}

export function isSpaceStatePersistenceBlocked(id: string): boolean {
  return blockedStatePersistence.has(id);
}

export function newSpaceId(): string {
  return `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
