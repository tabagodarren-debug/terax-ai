import type { ShortcutId } from "@/modules/shortcuts/shortcuts";

function isPaneSwapShortcut(id: ShortcutId): boolean {
  return (
    id === "pane.swapLeft" ||
    id === "pane.swapRight" ||
    id === "pane.swapUp" ||
    id === "pane.swapDown"
  );
}

export function shouldDisableEditorShortcut(
  id: ShortcutId,
  activeTabKind: string | null,
): boolean {
  return (
    (id === "editor.save" ||
      id === "editor.saveAll" ||
      id === "editor.undo" ||
      id === "editor.redo" ||
      id === "editor.aiComplete" ||
      id === "editor.codeComplete") &&
    activeTabKind !== "editor"
  );
}

export function shouldDisablePaneSwapShortcut(
  id: ShortcutId,
  terminalPaneCount: number | null,
): boolean {
  return (
    isPaneSwapShortcut(id) &&
    (terminalPaneCount === null || terminalPaneCount < 2)
  );
}
