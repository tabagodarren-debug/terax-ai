import { beforeEach, describe, expect, it, vi } from "vitest";

const persistence = vi.hoisted(() => ({
  deleteSpaceData: vi.fn(),
  saveActiveId: vi.fn(),
  saveSpacesList: vi.fn(),
}));

vi.mock("./store", () => ({
  deleteSpaceData: persistence.deleteSpaceData,
  newSpaceId: vi.fn(() => "sp-generated"),
  saveActiveId: persistence.saveActiveId,
  saveSpacesList: persistence.saveSpacesList,
}));

import { createDefaultWorkstationAgentPresets } from "@/modules/agents/lib/presets";
import type { SpaceMeta } from "./store";
import { useSpaces } from "./useSpaces";

function space(id: string, root = `C:\\work\\${id}`): SpaceMeta {
  return {
    id,
    name: id.toUpperCase(),
    root,
    env: { kind: "local" },
    agentPresets: createDefaultWorkstationAgentPresets(),
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("useSpaces", () => {
  beforeEach(() => {
    persistence.deleteSpaceData.mockReset().mockResolvedValue(undefined);
    persistence.saveActiveId.mockReset().mockResolvedValue(undefined);
    persistence.saveSpacesList.mockReset().mockResolvedValue(undefined);
    useSpaces.setState({
      spaces: [],
      activeId: null,
      hydrated: false,
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

  it("renames, changes roots, and reorders without changing ids", () => {
    useSpaces.getState().hydrate([space("a"), space("b")], "a");

    useSpaces.getState().rename("a", "  Renamed  ");
    useSpaces.getState().setRoot("a", "D:\\moved");
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
});
