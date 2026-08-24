import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMock = vi.hoisted(() => ({
  entries: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    entries = storeMock.entries;
    set = storeMock.set;
    delete = storeMock.delete;
  },
}));

import {
  createDefaultWorkstationAgentPresets,
  DEFAULT_WORKSTATION_AGENT_PRESETS,
} from "@/modules/agents/lib/presets";
import {
  deleteSpaceData,
  loadAll,
  migratePersistedSpaces,
  SPACE_STORE_SCHEMA_VERSION,
  saveActiveId,
  saveSpacesList,
  saveState,
} from "./store";

const legacySpace = {
  id: "sp-existing",
  name: "Existing",
  root: "C:\\work\\existing",
  env: { kind: "wsl" as const, distro: "Ubuntu" },
  color: 3,
  createdAt: 10,
  updatedAt: 20,
};

const migratedLegacySpace = {
  ...legacySpace,
  agentPresets: createDefaultWorkstationAgentPresets(),
};

describe("migratePersistedSpaces", () => {
  it("migrates an unversioned record to four presets without changing metadata", () => {
    const result = migratePersistedSpaces([legacySpace], undefined);

    expect(result).toEqual({ spaces: [migratedLegacySpace], needsWrite: true });
  });

  it("migrates a Phase 1 record and does not rewrite a current record", () => {
    expect(migratePersistedSpaces([legacySpace], 1)).toEqual({
      spaces: [migratedLegacySpace],
      needsWrite: true,
    });

    const result = migratePersistedSpaces(
      [migratedLegacySpace],
      SPACE_STORE_SCHEMA_VERSION,
    );

    expect(result).toEqual({
      spaces: [migratedLegacySpace],
      needsWrite: false,
    });
  });

  it("normalizes malformed presets and duplicate roles without losing identity", () => {
    const malformedPresets = [
      {
        ...DEFAULT_WORKSTATION_AGENT_PRESETS[1],
        name: "Writer",
        launcherId: "codex",
      },
      {
        ...DEFAULT_WORKSTATION_AGENT_PRESETS[1],
        name: "Duplicate",
      },
      { id: "script-reviewer", launcherId: "invalid" },
    ];
    const result = migratePersistedSpaces(
      [
        { ...legacySpace, agentPresets: malformedPresets },
        { ...legacySpace, name: "Duplicate" },
        { id: "broken" },
      ],
      1,
    );

    expect(result.spaces).toHaveLength(1);
    expect(result.spaces[0]).toMatchObject({
      id: legacySpace.id,
      name: legacySpace.name,
      root: legacySpace.root,
      env: legacySpace.env,
      color: legacySpace.color,
      createdAt: legacySpace.createdAt,
      updatedAt: legacySpace.updatedAt,
    });
    expect(result.spaces[0].agentPresets).toHaveLength(4);
    expect(result.spaces[0].agentPresets[1]).toMatchObject({
      id: "script-generator",
      name: "Writer",
      launcherId: "codex",
      customCommand: null,
      promptFile: "agents/script-generator/prompt.md",
    });
    expect(result.needsWrite).toBe(true);
  });

  it("normalizes but does not rewrite a store written by a newer application", () => {
    const result = migratePersistedSpaces(
      [legacySpace],
      SPACE_STORE_SCHEMA_VERSION + 1,
    );

    expect(result.spaces).toEqual([migratedLegacySpace]);
    expect(result.needsWrite).toBe(false);
  });
});

describe("loadAll", () => {
  beforeEach(() => {
    storeMock.entries.mockReset();
    storeMock.set.mockReset().mockResolvedValue(undefined);
    storeMock.delete.mockReset().mockResolvedValue(undefined);
  });

  it("versions the legacy list while preserving active id and tab snapshots", async () => {
    const snapshot = { tabs: [], activeTabIndex: 2 };
    storeMock.entries.mockResolvedValue([
      ["spaces", [legacySpace]],
      ["activeId", legacySpace.id],
      [`state:${legacySpace.id}`, snapshot],
    ]);

    const loaded = await loadAll();

    expect(loaded.spaces).toEqual([migratedLegacySpace]);
    expect(loaded.activeId).toBe(legacySpace.id);
    expect(loaded.states.get(legacySpace.id)).toBe(snapshot);
    expect(storeMock.set).toHaveBeenNthCalledWith(1, "spaces", [
      migratedLegacySpace,
    ]);
    expect(storeMock.set).toHaveBeenNthCalledWith(
      2,
      "schemaVersion",
      SPACE_STORE_SCHEMA_VERSION,
    );
  });

  it("keeps a future-version store read-only for the session", async () => {
    storeMock.entries.mockResolvedValue([
      ["schemaVersion", SPACE_STORE_SCHEMA_VERSION + 1],
      ["spaces", [legacySpace]],
    ]);

    const loaded = await loadAll();

    expect(loaded.spaces).toEqual([migratedLegacySpace]);
    await saveSpacesList(loaded.spaces);
    await saveActiveId(legacySpace.id);
    await saveState(legacySpace.id, { tabs: [], activeTabIndex: 0 });
    await deleteSpaceData(legacySpace.id);
    expect(storeMock.set).not.toHaveBeenCalled();
    expect(storeMock.delete).not.toHaveBeenCalled();
  });
});
