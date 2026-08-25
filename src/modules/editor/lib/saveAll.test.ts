import {
  createSaveAllCoordinator,
  saveAllDirtyEditors,
  saveEditor,
} from "@/modules/editor/lib/saveAll";
import type { Tab } from "@/modules/tabs";
import { describe, expect, it, vi } from "vitest";

function editor(id: number, dirty: boolean): Tab {
  return {
    id,
    kind: "editor",
    spaceId: "space-a",
    title: `${id}.ts`,
    path: `C:/work/${id}.ts`,
    dirty,
    preview: false,
  };
}

describe("saveAllDirtyEditors", () => {
  it("saves every dirty mounted editor and skips clean buffers", async () => {
    const saveOne = vi.fn(async () => true);
    const saveThree = vi.fn(async () => true);
    const handles = new Map([
      [1, { save: saveOne }],
      [3, { save: saveThree }],
    ]);

    await expect(
      saveAllDirtyEditors(
        [editor(1, true), editor(2, false), editor(3, true)],
        (id) => handles.get(id),
      ),
    ).resolves.toEqual({
      ok: true,
      savedIds: [1, 3],
      failedIds: [],
      unavailableIds: [],
    });
    expect(saveOne).toHaveBeenCalledOnce();
    expect(saveThree).toHaveBeenCalledOnce();
  });

  it("fails closed for rejected, conflicted, and unavailable editors", async () => {
    const handles = new Map([
      [1, { save: vi.fn(async () => false) }],
      [2, { save: vi.fn(async () => Promise.reject(new Error("disk full"))) }],
    ]);

    const result = await saveAllDirtyEditors(
      [editor(1, true), editor(2, true), editor(3, true)],
      (id) => handles.get(id),
    );
    expect(result.ok).toBe(false);
    expect(result.savedIds).toEqual([]);
    expect(result.failedIds.sort()).toEqual([1, 2]);
    expect(result.unavailableIds).toEqual([3]);
  });
});

describe("save coordination", () => {
  it("turns a rejected active-editor save into a handled failure", async () => {
    await expect(
      saveEditor({
        save: vi.fn(async () => Promise.reject(new Error("disk full"))),
      }),
    ).resolves.toBe(false);
  });

  it("deduplicates overlapping save-all requests and allows a later retry", async () => {
    let release: ((value: boolean) => void) | undefined;
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const coordinated = createSaveAllCoordinator(save);

    const first = coordinated();
    const second = coordinated();
    expect(second).toBe(first);
    expect(save).toHaveBeenCalledTimes(1);

    release?.(true);
    await expect(first).resolves.toBe(true);

    const third = coordinated();
    expect(save).toHaveBeenCalledTimes(2);
    release?.(false);
    await expect(third).resolves.toBe(false);
  });
});
