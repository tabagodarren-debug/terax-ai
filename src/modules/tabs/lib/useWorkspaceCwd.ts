import { useCallback, useEffect, useRef } from "react";
import type { Tab } from "./useTabs";

type Result = {
  explorerRoot: string | null;
  inheritedCwdForNewTab: () => string | undefined;
};

type UseWorkspaceCwdInput = {
  workstationId: string | null;
  workstationRoot: string | null | undefined;
  activeTab: Tab | undefined;
  fallbackRoot: string | null;
};

type RememberedTerminalCwd = {
  workstationKey: string;
  cwd: string;
};

function normalizeRoot(path: string): string {
  return path.replace(/\\/g, "/");
}

export function resolveExplorerRoot(
  workstationRoot: string | null | undefined,
  fallbackRoot: string | null,
): string | null {
  const root = workstationRoot || fallbackRoot;
  return root ? normalizeRoot(root) : null;
}

export function workstationCwdKey(
  workstationId: string | null,
  workstationRoot: string | null | undefined,
): string | null {
  if (!workstationId) return null;
  return `${workstationId}\0${workstationRoot ? normalizeRoot(workstationRoot) : ""}`;
}

export function resolveInheritedCwd(
  activeTab: Tab | undefined,
  workstationId: string | null,
  workstationKey: string | null,
  remembered: RememberedTerminalCwd | null,
  workstationRoot: string | null | undefined,
  fallbackRoot: string | null,
): string | undefined {
  if (
    workstationId &&
    activeTab?.spaceId === workstationId &&
    activeTab.kind === "terminal" &&
    activeTab.cwd
  ) {
    return activeTab.cwd;
  }
  if (workstationKey && remembered?.workstationKey === workstationKey) {
    return remembered.cwd;
  }
  return (
    resolveExplorerRoot(workstationRoot, null) ?? fallbackRoot ?? undefined
  );
}

export function useWorkspaceCwd({
  workstationId,
  workstationRoot,
  activeTab,
  fallbackRoot,
}: UseWorkspaceCwdInput): Result {
  const lastTerminalCwd = useRef<RememberedTerminalCwd | null>(null);
  const workstationKey = workstationCwdKey(workstationId, workstationRoot);

  useEffect(() => {
    if (
      workstationKey &&
      activeTab?.spaceId === workstationId &&
      activeTab.kind === "terminal" &&
      activeTab.cwd
    ) {
      lastTerminalCwd.current = { workstationKey, cwd: activeTab.cwd };
    }
  }, [activeTab, workstationId, workstationKey]);

  const explorerRoot = resolveExplorerRoot(workstationRoot, fallbackRoot);

  const inheritedCwdForNewTab = useCallback((): string | undefined => {
    // Editor tabs inherit the last terminal cwd for this workstation, not
    // the file's folder. A different workstation cannot reuse that memory.
    return resolveInheritedCwd(
      activeTab,
      workstationId,
      workstationKey,
      lastTerminalCwd.current,
      workstationRoot,
      fallbackRoot,
    );
  }, [activeTab, fallbackRoot, workstationId, workstationKey, workstationRoot]);

  return { explorerRoot, inheritedCwdForNewTab };
}
