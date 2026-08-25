import { describe, expect, it } from "vitest";
import type { PaneNode } from "@/modules/terminal/lib/panes";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import {
  hydrateTabs,
  migrateSerializedTabs,
  resolveWorkstationPathRef,
  serializeTabs,
  toWorkstationPathRef,
  type SerializedTab,
} from "./serialize";

function counter(start = 100): () => number {
  let n = start;
  return () => n++;
}

function leafIdsOf(node: PaneNode): number[] {
  return node.kind === "leaf" ? [node.id] : node.children.flatMap(leafIdsOf);
}

function term(over: Partial<Extract<Tab, { kind: "terminal" }>>): Tab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: "s1",
    title: "shell",
    paneTree: { kind: "leaf", id: 2, cwd: "/a" },
    activeLeafId: 2,
    ...over,
  } as Tab;
}

describe("serializeTabs", () => {
  it("drops private terminals and transient kinds", () => {
    const tabs: Tab[] = [
      term({ id: 1 }),
      term({ id: 3, private: true }),
      {
        id: 5,
        kind: "git-diff",
        spaceId: "s1",
        title: "d",
        path: "/a/x",
        repoRoot: "/a",
        mode: "+",
        originalPath: null,
        preview: true,
      },
      {
        id: 7,
        kind: "editor",
        spaceId: "s1",
        title: "x",
        path: "/a/x.ts",
        dirty: false,
        preview: false,
      },
    ];
    const out = serializeTabs(tabs, "/a");
    expect(out.map((t) => t.kind)).toEqual(["terminal", "editor"]);
  });

  it("marks the active leaf in a split tree", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 10,
      dir: "row",
      children: [
        { kind: "leaf", id: 11, cwd: "/a" },
        { kind: "leaf", id: 12, cwd: "/b" },
      ],
    };
    const [s] = serializeTabs(
      [term({ paneTree: tree, activeLeafId: 12 })],
      "/",
    );
    const node = s as Extract<SerializedTab, { kind: "terminal" }>;
    expect(node.tree.kind).toBe("split");
    if (node.tree.kind === "split") {
      expect(node.tree.children[1]).toMatchObject({
        cwd: { kind: "workstation-relative", path: "b" },
        active: true,
      });
      expect(node.tree.children[0]).not.toHaveProperty("active");
    }
  });
});

describe("hydrateTabs", () => {
  it("round-trips structure, cwd, blocks and active leaf", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 10,
      dir: "col",
      children: [
        { kind: "leaf", id: 11, cwd: "/a" },
        { kind: "leaf", id: 12, cwd: "/b" },
      ],
    };
    const tabs: Tab[] = [
      term({
        paneTree: tree,
        activeLeafId: 12,
        blocks: true,
        customTitle: "x",
      }),
    ];
    const serialized = serializeTabs(tabs, "/");
    const [restored] = hydrateTabs(serialized, "s2", "/", counter());
    expect(restored.kind).toBe("terminal");
    if (restored.kind !== "terminal") return;

    expect(restored.spaceId).toBe("s2");
    expect(restored.cold).toBe(true);
    expect(restored.blocks).toBe(true);
    expect(restored.customTitle).toBe("x");
    expect(restored.paneTree.kind).toBe("split");

    const leaves = leafIdsOf(restored.paneTree);
    expect(new Set(leaves).size).toBe(2);
    expect(leaves).toContain(restored.activeLeafId);
    // active leaf was the second one, which carried /b
    expect(restored.cwd).toBe("/b");
  });

  it("allocates fresh, unique, monotonic ids across all tabs and leaves", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 10,
      dir: "row",
      children: [
        { kind: "leaf", id: 11, cwd: "/a" },
        { kind: "leaf", id: 12, cwd: "/b" },
      ],
    };
    const serialized = serializeTabs(
      [term({ id: 1, paneTree: tree, activeLeafId: 11 }), term({ id: 2 })],
      "/",
    );
    const restored = hydrateTabs(serialized, "s1", "/", counter(100));

    const ids: number[] = [];
    for (const t of restored) {
      ids.push(t.id);
      if (t.kind === "terminal") ids.push(...leafIdsOf(t.paneTree));
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.min(...ids)).toBeGreaterThanOrEqual(100);
  });

  it("returns empty for corrupted input without throwing", () => {
    expect(hydrateTabs([] as SerializedTab[], "s1", "/a", counter())).toEqual(
      [],
    );
    expect(
      hydrateTabs(null as unknown as SerializedTab[], "s1", "/a", counter()),
    ).toEqual([]);
  });

  it("hydrates editor/preview/markdown as cold with derived titles", () => {
    const serialized: SerializedTab[] = [
      {
        kind: "editor",
        path: { kind: "workstation-relative", path: "foo.ts" },
      },
      { kind: "preview", url: "http://localhost:5173/x" },
      {
        kind: "markdown",
        path: { kind: "workstation-relative", path: "README.md" },
      },
    ];
    const out = hydrateTabs(serialized, "s1", "/a", counter());
    expect(out.every((t) => t.cold === true)).toBe(true);
    expect(out.map((t) => t.title)).toEqual([
      "foo.ts",
      "localhost:5173",
      "README.md",
    ]);
  });
});

describe("portable workstation paths", () => {
  it("stores Windows paths relative to a case-insensitive root", () => {
    expect(
      toWorkstationPathRef(
        "c:/Work/Campaign/scripts\\draft.md",
        "C:\\Work\\Campaign",
      ),
    ).toEqual({
      kind: "workstation-relative",
      path: "scripts/draft.md",
    });
  });

  it("resolves one relative reference under Windows or macOS roots", () => {
    const ref = { kind: "workstation-relative", path: "notes\\brief.md" };
    expect(resolveWorkstationPathRef(ref, "D:\\Afflow\\Campaign")).toBe(
      "D:/Afflow/Campaign/notes/brief.md",
    );
    expect(resolveWorkstationPathRef(ref, "/Users/me/Afflow/Campaign")).toBe(
      "/Users/me/Afflow/Campaign/notes/brief.md",
    );
  });

  it("does not serialize paths outside the workstation or on another drive", () => {
    const tabs: Tab[] = [
      term({ paneTree: { kind: "leaf", id: 2, cwd: "D:/outside" } }),
      {
        id: 3,
        kind: "editor",
        spaceId: "s1",
        title: "secret",
        path: "C:/Users/me/secret.txt",
        dirty: false,
        preview: false,
      },
      {
        id: 4,
        kind: "markdown",
        spaceId: "s1",
        title: "outside",
        path: "D:/outside.md",
      },
    ];

    expect(serializeTabs(tabs, "C:/Work/Campaign")).toEqual([
      { kind: "terminal", tree: { kind: "leaf", active: true } },
    ]);
  });

  it("migrates legacy Windows snapshots without retaining absolute paths", () => {
    const migrated = migrateSerializedTabs(
      [
        {
          kind: "terminal",
          tree: {
            kind: "leaf",
            cwd: "C:\\Work\\Campaign\\scripts",
            active: true,
          },
        },
        { kind: "editor", path: "C:\\Work\\Campaign\\src\\main.ts" },
        { kind: "markdown", path: "C:/Work/Campaign/README.md" },
      ],
      "C:\\Work\\Campaign",
    );

    expect(migrated.needsWrite).toBe(true);
    expect(migrated.tabs).toEqual([
      {
        kind: "terminal",
        tree: {
          kind: "leaf",
          cwd: { kind: "workstation-relative", path: "scripts" },
          active: true,
        },
      },
      {
        kind: "editor",
        path: { kind: "workstation-relative", path: "src/main.ts" },
      },
      {
        kind: "markdown",
        path: { kind: "workstation-relative", path: "README.md" },
      },
    ]);
  });

  it("preserves portable refs when a root is missing and restores after a move", () => {
    const serialized: SerializedTab[] = [
      {
        kind: "terminal",
        tree: {
          kind: "leaf",
          cwd: { kind: "workstation-relative", path: "scripts" },
          active: true,
        },
      },
      {
        kind: "editor",
        path: { kind: "workstation-relative", path: "src/main.ts" },
      },
    ];

    expect(migrateSerializedTabs(serialized, null)).toMatchObject({
      tabs: serialized,
      needsWrite: false,
    });
    const withoutRoot = hydrateTabs(serialized, "s1", null, counter());
    expect(withoutRoot).toHaveLength(1);
    expect(withoutRoot[0]).toMatchObject({ kind: "terminal", cwd: undefined });

    const moved = hydrateTabs(
      serialized,
      "s1",
      "/Users/me/Afflow/Campaign",
      counter(),
    );
    expect(moved[0]).toMatchObject({
      kind: "terminal",
      cwd: "/Users/me/Afflow/Campaign/scripts",
    });
    expect(moved[1]).toMatchObject({
      kind: "editor",
      path: "/Users/me/Afflow/Campaign/src/main.ts",
    });
  });

  it("rejects traversal and relative legacy inputs", () => {
    expect(
      resolveWorkstationPathRef(
        { kind: "workstation-relative", path: "../outside" },
        "/work/campaign",
      ),
    ).toBeNull();
    expect(
      toWorkstationPathRef("work/campaign/a", "/work/campaign"),
    ).toBeNull();
    expect(
      toWorkstationPathRef("C:/Work/Other/a", "C:/Work/Campaign"),
    ).toBeNull();
  });
});
