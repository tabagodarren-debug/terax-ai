import { usePreferencesStore } from "@/modules/settings/preferences";
import { parseWorkspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace";
import { create } from "zustand";
import {
  deleteSpaceData,
  newSpaceId,
  type SpaceMeta,
  saveActiveId,
  saveSpacesList,
} from "./store";

export type CreateInput = {
  id?: string;
  name: string;
  root: string | null;
  env?: WorkspaceEnv;
};

type State = {
  spaces: SpaceMeta[];
  activeId: string | null;
  hydrated: boolean;
  // Per-space active tab index loaded from disk, so persistence preserves it
  // for spaces the user never visits this session.
  initialActiveIndex: Record<string, number>;
  hydrate: (
    spaces: SpaceMeta[],
    activeId: string | null,
    initialActiveIndex?: Record<string, number>,
  ) => void;
  create: (input: CreateInput) => SpaceMeta;
  rename: (id: string, name: string) => void;
  setRoot: (id: string, root: string | null) => void;
  setEnv: (id: string, env: WorkspaceEnv) => void;
  setColor: (id: string, color: number | undefined) => void;
  reorder: (orderedIds: string[]) => void;
  archive: (id: string) => string | null;
  remove: (id: string) => string | null;
  setActive: (id: string) => void;
};

export const useSpaces = create<State>((set, get) => ({
  spaces: [],
  activeId: null,
  hydrated: false,
  initialActiveIndex: {},

  hydrate: (spaces, activeId, initialActiveIndex = {}) => {
    const restoredActiveId = spaces.some((space) => space.id === activeId)
      ? activeId
      : (spaces[0]?.id ?? null);
    set({
      spaces,
      activeId: restoredActiveId,
      initialActiveIndex,
      hydrated: true,
    });
  },

  create: (input) => {
    const name = input.name.trim();
    if (!name) throw new Error("Workstation name cannot be empty");
    const now = Date.now();
    const id = input.id ?? newSpaceId();
    if (get().spaces.some((space) => space.id === id)) {
      throw new Error(`Workstation id already exists: ${id}`);
    }
    const meta: SpaceMeta = {
      id,
      name,
      root: input.root,
      env:
        input.env ??
        parseWorkspaceScopeKey(
          usePreferencesStore.getState().defaultWorkspaceEnv,
        ),
      createdAt: now,
      updatedAt: now,
    };
    const spaces = [...get().spaces, meta];
    set({ spaces });
    void saveSpacesList(spaces);
    return meta;
  },

  rename: (id, name) => {
    const value = name.trim();
    if (!value) return;
    const current = get().spaces;
    if (!current.some((space) => space.id === id)) return;
    const spaces = current.map((space) =>
      space.id === id
        ? { ...space, name: value, updatedAt: Date.now() }
        : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  setRoot: (id, root) => {
    const current = get().spaces;
    if (!current.some((space) => space.id === id)) return;
    const spaces = current.map((space) =>
      space.id === id ? { ...space, root, updatedAt: Date.now() } : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  setEnv: (id, env) => {
    const current = get().spaces;
    if (!current.some((space) => space.id === id)) return;
    const spaces = current.map((space) =>
      space.id === id ? { ...space, env, updatedAt: Date.now() } : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  setColor: (id, color) => {
    const current = get().spaces;
    if (!current.some((space) => space.id === id)) return;
    const spaces = current.map((space) =>
      space.id === id ? { ...space, color, updatedAt: Date.now() } : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  reorder: (orderedIds) => {
    const byId = new Map(get().spaces.map((s) => [s.id, s]));
    const next: SpaceMeta[] = [];
    for (const id of orderedIds) {
      const s = byId.get(id);
      if (s) next.push(s);
    }
    for (const s of get().spaces) {
      if (!next.includes(s)) next.push(s);
    }
    if (next.length !== get().spaces.length) return;
    set({ spaces: next });
    void saveSpacesList(next);
  },

  archive: (id) => {
    const prev = get();
    const index = prev.spaces.findIndex((space) => space.id === id);
    if (index < 0 || prev.spaces.length <= 1) return prev.activeId;
    const spaces = prev.spaces.filter((s) => s.id !== id);
    let activeId = prev.activeId;
    if (activeId === id) {
      activeId = spaces[Math.min(index, spaces.length - 1)]?.id ?? null;
    }
    const initialActiveIndex = { ...prev.initialActiveIndex };
    delete initialActiveIndex[id];
    set({ spaces, activeId, initialActiveIndex });
    void saveSpacesList(spaces);
    void deleteSpaceData(id);
    if (activeId !== prev.activeId) void saveActiveId(activeId);
    return activeId;
  },

  remove: (id) => get().archive(id),

  setActive: (id) => {
    if (
      get().activeId === id ||
      !get().spaces.some((space) => space.id === id)
    ) {
      return;
    }
    set({ activeId: id });
    void saveActiveId(id);
  },
}));
