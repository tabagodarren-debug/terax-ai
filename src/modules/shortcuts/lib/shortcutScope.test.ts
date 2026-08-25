import {
  shouldDisableEditorShortcut,
  shouldDisablePaneSwapShortcut,
} from "@/modules/shortcuts/lib/shortcutScope";
import { describe, expect, it } from "vitest";

describe("shouldDisablePaneSwapShortcut", () => {
  it.each([
    "pane.swapLeft",
    "pane.swapRight",
    "pane.swapUp",
    "pane.swapDown",
  ] as const)("disables %s outside multi-pane terminals", (id) => {
    expect(shouldDisablePaneSwapShortcut(id, null)).toBe(true);
    expect(shouldDisablePaneSwapShortcut(id, 1)).toBe(true);
    expect(shouldDisablePaneSwapShortcut(id, 2)).toBe(false);
  });

  it("rejects unrelated shortcuts", () => {
    expect(shouldDisablePaneSwapShortcut("pane.focusNext", null)).toBe(false);
    expect(shouldDisablePaneSwapShortcut("editor.undo", 1)).toBe(false);
  });
});

describe("shouldDisableEditorShortcut", () => {
  it.each([
    "editor.save",
    "editor.saveAll",
    "editor.undo",
    "editor.redo",
    "editor.aiComplete",
    "editor.codeComplete",
  ] as const)("keeps %s scoped to editor tabs", (id) => {
    expect(shouldDisableEditorShortcut(id, "terminal")).toBe(true);
    expect(shouldDisableEditorShortcut(id, "editor")).toBe(false);
  });

  it("does not disable unrelated shortcuts", () => {
    expect(shouldDisableEditorShortcut("tab.new", "terminal")).toBe(false);
  });
});
