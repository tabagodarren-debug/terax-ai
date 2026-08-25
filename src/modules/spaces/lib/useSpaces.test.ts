import { beforeEach, describe, expect, it, vi } from "vitest";

const persistence = vi.hoisted(() => ({
  deleteSpaceData: vi.fn(),
  saveActiveId: vi.fn(),
  saveSpacesList: vi.fn(),
  flushStore: vi.fn(),
  setSpaceStatePersistenceBlocked: vi.fn(),
}));

vi.mock("./store", () => ({
  deleteSpaceData: persistence.deleteSpaceData,
  flushStore: persistence.flushStore,
  newSpaceId: vi.fn(() => "sp-generated"),
  saveActiveId: persistence.saveActiveId,
  saveSpacesList: persistence.saveSpacesList,
  setSpaceStatePersistenceBlocked: persistence.setSpaceStatePersistenceBlocked,
}));

import { createDefaultWorkstationAgentPresets } from "@/modules/agents/lib/presets";
import {
  browserProfileIdForWorkstation,
  createDefaultBrowserTools,
  createDefaultWorkstationBrowserState,
  isIsolatedBrowserProfileId,
} from "@/modules/browser-tools/lib/browserState";
import type { SpaceMeta } from "./store";
import { useSpaces } from "./useSpaces";

function space(id: string, root = `C:\\work\\${id}`): SpaceMeta {
  return {
    id,
    name: id.toUpperCase(),
    root,
    env: { kind: "local" },
    agentPresets: createDefaultWorkstationAgentPresets(),
    browser: createDefaultWorkstationBrowserState(
      browserProfileIdForWorkstation(id),
    ),
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("useSpaces", () => {
  beforeEach(() => {
    persistence.deleteSpaceData.mockReset().mockResolvedValue(undefined);
    persistence.saveActiveId.mockReset().mockResolvedValue(undefined);
    persistence.saveSpacesList.mockReset().mockResolvedValue(undefined);
    persistence.flushStore.mockReset().mockResolvedValue(undefined);
    persistence.setSpaceStatePersistenceBlocked.mockReset();
    useSpaces.setState({
      spaces: [],
      activeId: null,
      hydrated: false,
      unavailableRootIds: [],
      initialActiveIndex: {},
    });
  });

  it("creates a workstation with a stable id and persists the ordered list", () => {
    const meta = useSpaces.getState().create({
      id: "stable-id",
      name: "  Campaign  ",
      root: "C:\\campaign",
      env: { kind: "local" },
    });

    expect(meta).toMatchObject({
      id: "stable-id",
      name: "Campaign",
      root: "C:\\campaign",
    });
    expect(meta.agentPresets).toEqual(createDefaultWorkstationAgentPresets());
    expect(meta.browser).toMatchObject({
      profileMode: "workstation",
      tools: createDefaultBrowserTools(),
      openOnWorkstationLaunch: false,
    });
    expect(isIsolatedBrowserProfileId(meta.browser.profileId)).toBe(true);
    expect(useSpaces.getState().spaces).toEqual([meta]);
    expect(persistence.saveSpacesList).toHaveBeenCalledWith([meta]);
  });

  it("rejects empty names and duplicate ids", () => {
    useSpaces.getState().hydrate([space("a")], "a");

    expect(() =>
      useSpaces.getState().create({
        name: "  ",
        root: null,
        env: { kind: "local" },
      }),
    ).toThrow("Workstation name cannot be empty");
    expect(() =>
      useSpaces.getState().create({
        id: "a",
        name: "Duplicate",
        root: null,
        env: { kind: "local" },
      }),
    ).toThrow("Workstation id already exists: a");
  });

  it("renames, changes roots, and reorders without changing ids", async () => {
    useSpaces.getState().hydrate([space("a"), space("b")], "a");

    useSpaces.getState().rename("a", "  Renamed  ");
    await useSpaces.getState().setRoot("a", "D:\\moved");
    useSpaces.getState().reorder(["b", "a"]);

    expect(useSpaces.getState().spaces.map((item) => item.id)).toEqual([
      "b",
      "a",
    ]);
    expect(useSpaces.getState().spaces[1]).toMatchObject({
      id: "a",
      name: "Renamed",
      root: "D:\\moved",
    });
    expect(persistence.setSpaceStatePersistenceBlocked).toHaveBeenCalledWith(
      "a",
      false,
    );
  });

  it("tracks unavailable roots until the device mapping is replaced", async () => {
    useSpaces
      .getState()
      .hydrate(
        [space("available"), space("missing", "C:\\missing")],
        "available",
        {},
        ["missing"],
      );

    expect(useSpaces.getState().unavailableRootIds).toEqual(["missing"]);
    await useSpaces.getState().setRoot("missing", "D:\\relocated");
    expect(useSpaces.getState().unavailableRootIds).toEqual([]);

    await useSpaces.getState().setRoot("available", null);
    expect(useSpaces.getState().unavailableRootIds).toEqual(["available"]);
  });

  it("archives only metadata and selects the adjacent workstation", () => {
    const spaces = [space("a"), space("b", "D:\\external"), space("c")];
    useSpaces.getState().hydrate(spaces, "b", { a: 0, b: 2, c: 1 });

    const nextId = useSpaces.getState().archive("b");

    expect(nextId).toBe("c");
    expect(useSpaces.getState()).toMatchObject({
      spaces: [spaces[0], spaces[2]],
      activeId: "c",
      initialActiveIndex: { a: 0, c: 1 },
    });
    expect(persistence.deleteSpaceData).toHaveBeenCalledWith("b");
    expect(persistence.saveActiveId).toHaveBeenCalledWith("c");
    expect(persistence.deleteSpaceData).not.toHaveBeenCalledWith(
      "D:\\external",
    );
  });

  it("keeps the final workstation and ignores unknown active ids", () => {
    useSpaces.getState().hydrate([space("a")], "a");

    expect(useSpaces.getState().remove("a")).toBe("a");
    useSpaces.getState().setActive("missing");

    expect(useSpaces.getState().activeId).toBe("a");
    expect(persistence.saveSpacesList).not.toHaveBeenCalled();
    expect(persistence.deleteSpaceData).not.toHaveBeenCalled();
    expect(persistence.saveActiveId).not.toHaveBeenCalled();
  });

  it("falls back to the first workstation during hydration", () => {
    useSpaces.getState().hydrate([space("a"), space("b")], "missing", {
      a: 2,
    });

    expect(useSpaces.getState()).toMatchObject({
      activeId: "a",
      hydrated: true,
      initialActiveIndex: { a: 2 },
    });
  });

  it("updates one preset without sharing state between workstations", () => {
    useSpaces.getState().hydrate([space("a"), space("b")], "a");

    useSpaces.getState().updateAgentPreset("a", "script-generator", {
      name: "Campaign Writer",
      launcherId: "custom",
      customCommand: "writer-agent --local",
    });

    const [a, b] = useSpaces.getState().spaces;
    expect(a.agentPresets[1]).toMatchObject({
      name: "Campaign Writer",
      launcherId: "custom",
      customCommand: "writer-agent --local",
    });
    expect(b.agentPresets[1]).toEqual(
      createDefaultWorkstationAgentPresets()[1],
    );
    expect(a.agentPresets).not.toBe(b.agentPresets);
    expect(persistence.saveSpacesList).toHaveBeenLastCalledWith([a, b]);
  });

  it("resets one role or the complete preset list without affecting peers", () => {
    const a = space("a");
    a.agentPresets[1] = {
      ...a.agentPresets[1],
      launcherId: "codex",
      name: "Writer",
    };
    a.agentPresets[2] = {
      ...a.agentPresets[2],
      launcherId: "gemini",
    };
    const b = space("b");
    useSpaces.getState().hydrate([a, b], "a");

    useSpaces.getState().resetAgentPreset("a", "script-generator");
    expect(useSpaces.getState().spaces[0].agentPresets[1]).toEqual(
      createDefaultWorkstationAgentPresets()[1],
    );
    expect(useSpaces.getState().spaces[0].agentPresets[2].launcherId).toBe(
      "gemini",
    );

    useSpaces.getState().resetAgentPresets("a");
    const [resetA, unchangedB] = useSpaces.getState().spaces;
    expect(resetA.agentPresets).toEqual(createDefaultWorkstationAgentPresets());
    expect(unchangedB).toBe(b);
  });

  it("ignores preset mutations for unknown workstations or roles", () => {
    useSpaces.getState().hydrate([space("a")], "a");

    useSpaces.getState().updateAgentPreset("missing", "general", {
      launcherId: "codex",
    });
    useSpaces.getState().resetAgentPreset("a", "missing" as "general");
    useSpaces.getState().resetAgentPresets("missing");

    expect(useSpaces.getState().spaces).toEqual([space("a")]);
    expect(persistence.saveSpacesList).not.toHaveBeenCalled();
  });

  it("switches profile mode without replacing the isolated profile id", () => {
    useSpaces.getState().hydrate([space("a"), space("b")], "a");
    const isolatedId = useSpaces.getState().spaces[0].browser.profileId;

    useSpaces.getState().setBrowserProfileMode("a", "shared");
    useSpaces.getState().setBrowserOpenOnWorkstationLaunch("a", true);
    useSpaces.getState().setBrowserProfileMode("a", "workstation");

    const [a, b] = useSpaces.getState().spaces;
    expect(a.browser).toMatchObject({
      profileMode: "workstation",
      profileId: isolatedId,
      openOnWorkstationLaunch: true,
    });
    expect(b).toEqual(space("b"));
    expect(persistence.saveSpacesList).toHaveBeenLastCalledWith([a, b]);
  });

  it("adds, updates, reorders, and removes tools within one workstation", () => {
    const a = space("a");
    a.browser.tools = [];
    const b = space("b");
    useSpaces.getState().hydrate([a, b], "a");

    const first = useSpaces.getState().addBrowserTool("a", {
      name: "  Local App  ",
      url: "http://localhost:5173",
    });
    const second = useSpaces.getState().addBrowserTool("a", {
      name: "Research",
      url: "https://example.com/research",
    });
    expect(first).toMatchObject({
      name: "Local App",
      url: "http://localhost:5173/",
    });
    expect(second).not.toBeNull();

    useSpaces.getState().updateBrowserTool("a", first?.id ?? "", {
      name: "Workspace App",
    });
    useSpaces
      .getState()
      .reorderBrowserTools("a", [second?.id ?? "", first?.id ?? ""]);
    expect(
      useSpaces.getState().spaces[0].browser.tools.map((tool) => tool.name),
    ).toEqual(["Research", "Workspace App"]);

    useSpaces.getState().removeBrowserTool("a", second?.id ?? "");
    const [changedA, unchangedB] = useSpaces.getState().spaces;
    expect(changedA.browser.tools).toEqual([
      {
        id: first?.id,
        name: "Workspace App",
        url: "http://localhost:5173/",
      },
    ]);
    expect(unchangedB).toBe(b);
  });

  it("resets tools without replacing profile selection", () => {
    const a = space("a");
    a.browser = {
      ...a.browser,
      profileMode: "shared",
      tools: [],
      openOnWorkstationLaunch: true,
    };
    useSpaces.getState().hydrate([a], "a");

    useSpaces.getState().resetBrowserTools("a");

    expect(useSpaces.getState().spaces[0].browser).toEqual({
      profileMode: "shared",
      profileId: a.browser.profileId,
      tools: createDefaultBrowserTools(),
      openOnWorkstationLaunch: true,
    });
  });

  it("rejects invalid tool input and ignores unknown browser mutations", () => {
    useSpaces.getState().hydrate([space("a")], "a");

    expect(() =>
      useSpaces.getState().addBrowserTool("a", {
        name: "Unsafe",
        url: "file:///tmp/data",
      }),
    ).toThrow("HTTP or HTTPS");
    expect(
      useSpaces.getState().addBrowserTool("missing", {
        name: "Missing",
        url: "https://example.com",
      }),
    ).toBeNull();
    useSpaces.getState().updateBrowserTool("a", "missing", { name: "No" });
    useSpaces.getState().removeBrowserTool("a", "missing");
    useSpaces.getState().resetBrowserTools("missing");
    useSpaces.getState().setBrowserProfileMode("missing", "shared");
    useSpaces.getState().setBrowserOpenOnWorkstationLaunch("missing", true);

    expect(useSpaces.getState().spaces).toEqual([space("a")]);
    expect(persistence.saveSpacesList).not.toHaveBeenCalled();
  });
});
