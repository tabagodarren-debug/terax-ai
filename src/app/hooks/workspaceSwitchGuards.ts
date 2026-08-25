import type { CloseManyHazards } from "@/app/hooks/tabCloseGuards";

export function workspaceSwitchBlockedMessage({
  dirtyIds,
  busyLeafIds,
}: CloseManyHazards): string | null {
  if (dirtyIds.length > 0) {
    return "Save or close unsaved editor tabs before switching workspace.";
  }
  if (busyLeafIds.length > 0) {
    return busyLeafIds.length === 1
      ? "Stop the running terminal process before switching workspace."
      : "Stop the running terminal processes before switching workspace.";
  }
  return null;
}
