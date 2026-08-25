import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import type { Tab } from "@/modules/tabs";

export type SaveAllEditorsResult = {
  ok: boolean;
  savedIds: number[];
  failedIds: number[];
  unavailableIds: number[];
};

export async function saveEditor(
  handle: Pick<EditorPaneHandle, "save">,
): Promise<boolean> {
  try {
    return await handle.save();
  } catch {
    return false;
  }
}

export function createSaveAllCoordinator(
  saveAll: () => Promise<boolean>,
): () => Promise<boolean> {
  let pending: Promise<boolean> | null = null;
  return () => {
    if (pending) return pending;
    const operation = saveAll().finally(() => {
      if (pending === operation) pending = null;
    });
    pending = operation;
    return operation;
  };
}

export async function saveAllDirtyEditors(
  tabs: readonly Tab[],
  getHandle: (id: number) => Pick<EditorPaneHandle, "save"> | null | undefined,
): Promise<SaveAllEditorsResult> {
  const dirtyIds = tabs
    .filter((tab) => tab.kind === "editor" && tab.dirty)
    .map((tab) => tab.id);
  const outcomes = await Promise.all(
    dirtyIds.map(async (id) => {
      const handle = getHandle(id);
      if (!handle) {
        return { id, status: "unavailable" as const };
      }
      return {
        id,
        status: ((await saveEditor(handle)) ? "saved" : "failed") as
          | "saved"
          | "failed",
      };
    }),
  );
  const savedIds = outcomes
    .filter((outcome) => outcome.status === "saved")
    .map((outcome) => outcome.id);
  const failedIds = outcomes
    .filter((outcome) => outcome.status === "failed")
    .map((outcome) => outcome.id);
  const unavailableIds = outcomes
    .filter((outcome) => outcome.status === "unavailable")
    .map((outcome) => outcome.id);

  return {
    ok: failedIds.length === 0 && unavailableIds.length === 0,
    savedIds,
    failedIds,
    unavailableIds,
  };
}
