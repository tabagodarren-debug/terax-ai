import { describe, expect, it } from "vitest";
import type { EditorTab, TerminalTab } from "./useTabs";
import {
  resolveExplorerRoot,
  resolveInheritedCwd,
  workstationCwdKey,
} from "./useWorkspaceCwd";

function terminalTab(cwd?: string, spaceId = "workstation-a"): TerminalTab {
  return {
    id: 1,
    kind: "terminal",
    spaceId,
    title: "shell",
    cwd,
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
  };
}

function editorTab(spaceId = "workstation-a"): EditorTab {
  return {
    id: 3,
    kind: "editor",
    spaceId,
    title: "notes.md",
    path: `/${spaceId}/notes.md`,
    dirty: false,
    preview: false,
  };
}

describe("resolveExplorerRoot", () => {
  it("keeps the explorer on the workstation root after a terminal navigates", () => {
    const navigatedTerminal = terminalTab("/shared/research");

    expect(
      resolveExplorerRoot("/workstation-a", navigatedTerminal.cwd ?? null),
    ).toBe("/workstation-a");
    expect(
      resolveExplorerRoot("/workstation-b", navigatedTerminal.cwd ?? null),
    ).toBe("/workstation-b");
  });

  it("normalizes Windows workstation and fallback paths", () => {
    expect(
      resolveExplorerRoot("C:\\Users\\Admin\\Afflow", "D:\\Fallback"),
    ).toBe("C:/Users/Admin/Afflow");
    expect(resolveExplorerRoot(null, "D:\\Fallback\\Project")).toBe(
      "D:/Fallback/Project",
    );
    expect(workstationCwdKey("workstation-a", "C:\\Users\\Admin\\Afflow")).toBe(
      workstationCwdKey("workstation-a", "C:/Users/Admin/Afflow"),
    );
  });

  it("uses the fallback only when the workstation root is missing", () => {
    expect(resolveExplorerRoot(null, "/home/admin")).toBe("/home/admin");
    expect(resolveExplorerRoot("", "/home/admin")).toBe("/home/admin");
    expect(resolveExplorerRoot(undefined, null)).toBeNull();
  });
});

describe("resolveInheritedCwd", () => {
  it("inherits the active terminal cwd unchanged", () => {
    const key = workstationCwdKey("workstation-a", "C:\\Workstation");

    expect(
      resolveInheritedCwd(
        terminalTab("C:\\Users\\Admin\\elsewhere"),
        "workstation-a",
        key,
        null,
        "C:\\Workstation",
        "/fallback",
      ),
    ).toBe("C:\\Users\\Admin\\elsewhere");
  });

  it("inherits the last terminal cwd within the current workstation", () => {
    const key = workstationCwdKey("workstation-a", "/workstation-a");

    expect(
      resolveInheritedCwd(
        editorTab(),
        "workstation-a",
        key,
        { workstationKey: key as string, cwd: "/workstation-a/scripts" },
        "/workstation-a",
        "/fallback",
      ),
    ).toBe("/workstation-a/scripts");
  });

  it("does not carry a navigated cwd into a different workstation", () => {
    const oldKey = workstationCwdKey("workstation-a", "/workstation-a");
    const newKey = workstationCwdKey("workstation-b", "/workstation-b");

    expect(
      resolveInheritedCwd(
        editorTab("workstation-b"),
        "workstation-b",
        newKey,
        { workstationKey: oldKey as string, cwd: "/shared/research" },
        "/workstation-b",
        "/fallback",
      ),
    ).toBe("/workstation-b");
  });

  it("ignores the previous active terminal during a workstation switch", () => {
    const newKey = workstationCwdKey("workstation-b", "/workstation-b");

    expect(
      resolveInheritedCwd(
        terminalTab("/shared/research", "workstation-a"),
        "workstation-b",
        newKey,
        null,
        "/workstation-b",
        "/fallback",
      ),
    ).toBe("/workstation-b");
  });

  it("invalidates remembered cwd when a workstation root changes", () => {
    const oldKey = workstationCwdKey("workstation-a", "/workstation-a");
    const movedKey = workstationCwdKey("workstation-a", "/moved-a");

    expect(
      resolveInheritedCwd(
        editorTab(),
        "workstation-a",
        movedKey,
        { workstationKey: oldKey as string, cwd: "/workstation-a/scripts" },
        "/moved-a",
        "/fallback",
      ),
    ).toBe("/moved-a");
  });

  it("falls back when the workstation has no root or terminal cwd", () => {
    expect(
      resolveInheritedCwd(
        editorTab(),
        "workstation-a",
        "workstation-a\0",
        null,
        null,
        "/home",
      ),
    ).toBe("/home");
    expect(
      resolveInheritedCwd(undefined, null, null, null, null, null),
    ).toBeUndefined();
  });
});
