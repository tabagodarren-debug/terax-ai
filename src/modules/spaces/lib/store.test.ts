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
  loadAll,
  migratePersistedSpaces,
  SPACE_STORE_SCHEMA_VERSION,
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
  it("migrates the unversioned Phase 0 record without changing its identity", () => {
    const result = migratePersistedSpaces([legacySpace], undefined);

    expect(result).toEqual({ spaces: [legacySpace], needsWrite: true });
  });

  it("does not rewrite an already current record", () => {
    const result = migratePersistedSpaces(
      [legacySpace],
      SPACE_STORE_SCHEMA_VERSION,
    );

    expect(result).toEqual({ spaces: [legacySpace], needsWrite: false });
  });

  it("drops malformed and duplicate records without changing stable ids", () => {
    const result = migratePersistedSpaces(
      [legacySpace, { ...legacySpace, name: "Duplicate" }, { id: "broken" }],
      undefined,
    );

    expect(result.spaces).toEqual([legacySpace]);
    expect(result.needsWrite).toBe(true);
  });

  it("does not downgrade a store written by a newer application", () => {
    const result = migratePersistedSpaces(
      [legacySpace],
      SPACE_STORE_SCHEMA_VERSION + 1,
    );

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

    expect(loaded.spaces).toEqual([legacySpace]);
    expect(loaded.activeId).toBe(legacySpace.id);
    expect(loaded.states.get(legacySpace.id)).toBe(snapshot);
    expect(storeMock.set).toHaveBeenNthCalledWith(1, "spaces", [legacySpace]);
    expect(storeMock.set).toHaveBeenNthCalledWith(
      2,
      "schemaVersion",
      SPACE_STORE_SCHEMA_VERSION,
    );
  });
});
