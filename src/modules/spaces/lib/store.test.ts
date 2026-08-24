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
  createDefaultWorkstationBrowserState,
  isIsolatedBrowserProfileId,
} from "@/modules/browser-tools/lib/browserState";
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

describe("migratePersistedSpaces", () => {
  it("migrates an unversioned record to four presets without changing metadata", () => {
    const result = migratePersistedSpaces([legacySpace], undefined);

    expect(result.needsWrite).toBe(true);
    expect(result.spaces).toHaveLength(1);
    expect(result.spaces[0]).toMatchObject({
      ...legacySpace,
      agentPresets: createDefaultWorkstationAgentPresets(),
      browser: {
        profileMode: "workstation",
        openOnWorkstationLaunch: false,
      },
    });
    expect(isIsolatedBrowserProfileId(result.spaces[0].browser.profileId)).toBe(
      true,
    );
  });

  it("migrates Phase 1 and 2 records and does not rewrite a current record", () => {
    const phaseOne = migratePersistedSpaces([legacySpace], 1);
    const phaseTwo = migratePersistedSpaces([legacySpace], 2);
    const repeated = migratePersistedSpaces([legacySpace], 2);
    const other = migratePersistedSpaces(
      [{ ...legacySpace, id: "sp-other" }],
      2,
    );

    expect(phaseOne.needsWrite).toBe(true);
    expect(phaseTwo.needsWrite).toBe(true);
    expect(repeated.spaces[0].browser.profileId).toBe(
      phaseTwo.spaces[0].browser.profileId,
    );
    expect(other.spaces[0].browser.profileId).not.toBe(
      phaseTwo.spaces[0].browser.profileId,
    );

    const currentSpace = {
      ...legacySpace,
      agentPresets: createDefaultWorkstationAgentPresets(),
      browser: createDefaultWorkstationBrowserState("bp-existing"),
    };

    const result = migratePersistedSpaces(
      [currentSpace],
      SPACE_STORE_SCHEMA_VERSION,
    );

    expect(result).toEqual({
      spaces: [currentSpace],
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
    const repeated = migratePersistedSpaces(
      [legacySpace],
      SPACE_STORE_SCHEMA_VERSION + 1,
    );

    expect(result.spaces[0]).toMatchObject({
      ...legacySpace,
      agentPresets: createDefaultWorkstationAgentPresets(),
      browser: { profileMode: "workstation" },
    });
    expect(repeated.spaces[0].browser.profileId).toBe(
      result.spaces[0].browser.profileId,
    );
    expect(result.needsWrite).toBe(false);
  });

  it("repairs malformed browser state while preserving Phase 2 fields", () => {
    const result = migratePersistedSpaces(
      [
        {
          ...legacySpace,
          agentPresets: createDefaultWorkstationAgentPresets(),
          browser: {
            profileMode: "shared",
            profileId: "shared-v1",
            tools: [
              { id: "local", name: " Local ", url: "http://localhost:3000" },
              { id: "local", name: "Duplicate", url: "https://example.com" },
              { id: "bad.id", name: "Bad", url: "file:///tmp" },
            ],
            openOnWorkstationLaunch: "yes",
          },
        },
      ],
      SPACE_STORE_SCHEMA_VERSION,
    );

    expect(result.needsWrite).toBe(true);
    expect(result.spaces[0]).toMatchObject({
      ...legacySpace,
      agentPresets: createDefaultWorkstationAgentPresets(),
      browser: {
        profileMode: "shared",
        tools: [{ id: "local", name: "Local", url: "http://localhost:3000/" }],
        openOnWorkstationLaunch: false,
      },
    });
    expect(isIsolatedBrowserProfileId(result.spaces[0].browser.profileId)).toBe(
      true,
    );
  });

  it("removes query and fragment data from persisted browser tools", () => {
    const currentSpace = {
      ...legacySpace,
      agentPresets: createDefaultWorkstationAgentPresets(),
      browser: {
        ...createDefaultWorkstationBrowserState("bp-existing"),
        tools: [
          {
            id: "sensitive-link",
            name: "Sensitive link",
            url: "https://example.com/tool?token=secret#result",
          },
        ],
      },
    };

    const result = migratePersistedSpaces(
      [currentSpace],
      SPACE_STORE_SCHEMA_VERSION,
    );

    expect(result.needsWrite).toBe(true);
    expect(result.spaces[0].browser.tools).toEqual([
      {
        id: "sensitive-link",
        name: "Sensitive link",
        url: "https://example.com/tool",
      },
    ]);
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

    expect(loaded.spaces[0]).toMatchObject({
      ...legacySpace,
      agentPresets: createDefaultWorkstationAgentPresets(),
      browser: { profileMode: "workstation" },
    });
    expect(loaded.activeId).toBe(legacySpace.id);
    expect(loaded.states.get(legacySpace.id)).toBe(snapshot);
    expect(storeMock.set).toHaveBeenNthCalledWith(1, "spaces", loaded.spaces);
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

    expect(loaded.spaces[0]).toMatchObject({
      ...legacySpace,
      agentPresets: createDefaultWorkstationAgentPresets(),
      browser: { profileMode: "workstation" },
    });
    await saveSpacesList(loaded.spaces);
    await saveActiveId(legacySpace.id);
    await saveState(legacySpace.id, { tabs: [], activeTabIndex: 0 });
    await deleteSpaceData(legacySpace.id);
    expect(storeMock.set).not.toHaveBeenCalled();
    expect(storeMock.delete).not.toHaveBeenCalled();
  });
});
