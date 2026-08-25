import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeWorkstationRoot: vi.fn(),
  loadAll: vi.fn(),
  setSpaceStatePersistenceBlocked: vi.fn(),
}));

vi.mock("./workstationNative", () => ({
  authorizeWorkstationRoot: mocks.authorizeWorkstationRoot,
}));

vi.mock("./store", () => ({
  loadAll: mocks.loadAll,
  saveActiveId: vi.fn(),
  saveSpacesList: vi.fn(),
  setSpaceStatePersistenceBlocked: mocks.setSpaceStatePersistenceBlocked,
}));

import { createDefaultWorkstationAgentPresets } from "@/modules/agents/lib/presets";
import { createDefaultWorkstationBrowserState } from "@/modules/browser-tools/lib/browserState";
import type { SpaceMeta } from "./store";
import { authorizeSavedRoots, restoreSavedSpaceTabs } from "./useSpacesBoot";

function space(
  id: string,
  root: string | null,
  env: SpaceMeta["env"] = { kind: "local" },
): SpaceMeta {
  return {
    id,
    name: id,
    root,
    env,
    agentPresets: createDefaultWorkstationAgentPresets(),
    browser: createDefaultWorkstationBrowserState(`bp-${id}`),
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("authorizeSavedRoots", () => {
  beforeEach(() => {
    mocks.authorizeWorkstationRoot.mockReset();
    mocks.loadAll.mockReset();
    mocks.setSpaceStatePersistenceBlocked.mockReset();
  });

  it("authorizes each mapped root in its own environment before restoration", async () => {
    mocks.authorizeWorkstationRoot.mockImplementation(async (root: string) => {
      if (root === "C:\\missing") throw new Error("not found");
      return root.replace(/\\/g, "/");
    });
    const spaces = [
      space("local", "C:\\Work\\Campaign"),
      space("wsl", "/home/me/campaign", {
        kind: "wsl",
        distro: "Ubuntu",
      }),
      space("missing", "C:\\missing"),
      space("unmapped", null),
    ];

    const roots = await authorizeSavedRoots(spaces);

    expect([...roots]).toEqual([
      ["local", "C:\\Work\\Campaign"],
      ["wsl", "/home/me/campaign"],
    ]);
    expect(mocks.authorizeWorkstationRoot).toHaveBeenCalledWith(
      "C:\\Work\\Campaign",
      { kind: "local" },
    );
    expect(mocks.authorizeWorkstationRoot).toHaveBeenCalledWith(
      "/home/me/campaign",
      { kind: "wsl", distro: "Ubuntu" },
    );
    expect(mocks.authorizeWorkstationRoot).not.toHaveBeenCalledWith(
      null,
      expect.anything(),
    );
    expect(mocks.setSpaceStatePersistenceBlocked.mock.calls).toEqual([
      ["local", false],
      ["wsl", false],
      ["missing", true],
      ["unmapped", true],
    ]);
  });

  it("restores the preserved relative-path snapshot under a relocated root", async () => {
    mocks.loadAll.mockResolvedValue({
      spaces: [],
      activeId: "moved",
      states: new Map([
        [
          "moved",
          {
            tabs: [
              {
                kind: "editor",
                path: { kind: "workstation-relative", path: "notes/today.md" },
              },
            ],
            activeTabIndex: 0,
          },
        ],
      ]),
    });
    let nextId = 10;

    const restored = await restoreSavedSpaceTabs(
      "moved",
      "/Users/me/Work/campaign",
      () => nextId++,
    );

    expect(restored.activeTabIndex).toBe(0);
    expect(restored.tabs).toEqual([
      expect.objectContaining({
        id: 10,
        kind: "editor",
        path: "/Users/me/Work/campaign/notes/today.md",
      }),
    ]);
  });
});
