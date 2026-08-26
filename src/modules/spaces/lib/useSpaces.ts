import {
  type AfflowAgentPresetId,
  createDefaultWorkstationAgentPresets,
  DEFAULT_WORKSTATION_AGENT_PRESETS,
  isCustomAgentPresetId,
  MAX_CUSTOM_AGENT_PRESETS,
  normalizeWorkstationAgentPresets,
  validateWorkstationAgentPreset,
  type WorkstationAgentPreset,
} from "@/modules/agents/lib/presets";
import {
  browserToolUrlBytes,
  createDefaultBrowserTools,
  createDefaultWorkstationBrowserState,
  MAX_BROWSER_TOOLS,
  MAX_BROWSER_URL_TOTAL_BYTES,
  newBrowserToolId,
  validateBrowserToolInput,
} from "@/modules/browser-tools/lib/browserState";
import type {
  BrowserProfileMode,
  BrowserTool,
  BrowserToolInput,
} from "@/modules/browser-tools/lib/types";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { parseWorkspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace";
import { create } from "zustand";
import {
  deleteSpaceData,
  flushStore,
  newSpaceId,
  type SpaceMeta,
  saveActiveId,
  saveSpacesList,
  setSpaceStatePersistenceBlocked,
} from "./store";

export type CreateInput = {
  id?: string;
  name: string;
  root: string | null;
  env?: WorkspaceEnv;
};

export type AgentPresetUpdate = Partial<
  Pick<WorkstationAgentPreset, "name" | "launcherId" | "customCommand">
>;

export type BrowserToolUpdate = Partial<BrowserToolInput>;

type State = {
  spaces: SpaceMeta[];
  activeId: string | null;
  hydrated: boolean;
  unavailableRootIds: string[];
  // Per-space active tab index loaded from disk, so persistence preserves it
  // for spaces the user never visits this session.
  initialActiveIndex: Record<string, number>;
  hydrate: (
    spaces: SpaceMeta[],
    activeId: string | null,
    initialActiveIndex?: Record<string, number>,
    unavailableRootIds?: string[],
  ) => void;
  create: (input: CreateInput) => SpaceMeta;
  rename: (id: string, name: string) => void;
  setRoot: (id: string, root: string | null) => Promise<void>;
  setEnv: (id: string, env: WorkspaceEnv) => void;
  setColor: (id: string, color: number | undefined) => void;
  reorder: (orderedIds: string[]) => void;
  updateAgentPreset: (
    workstationId: string,
    presetId: AfflowAgentPresetId,
    update: AgentPresetUpdate,
  ) => void;
  addAgentPreset: (
    workstationId: string,
    preset: WorkstationAgentPreset,
  ) => void;
  removeAgentPreset: (
    workstationId: string,
    presetId: AfflowAgentPresetId,
  ) => void;
  resetAgentPreset: (
    workstationId: string,
    presetId: AfflowAgentPresetId,
  ) => void;
  resetAgentPresets: (workstationId: string) => void;
  setBrowserProfileMode: (
    workstationId: string,
    mode: BrowserProfileMode,
  ) => void;
  setBrowserOpenOnWorkstationLaunch: (
    workstationId: string,
    enabled: boolean,
  ) => void;
  addBrowserTool: (
    workstationId: string,
    input: BrowserToolInput,
  ) => BrowserTool | null;
  updateBrowserTool: (
    workstationId: string,
    toolId: string,
    update: BrowserToolUpdate,
  ) => void;
  removeBrowserTool: (workstationId: string, toolId: string) => void;
  reorderBrowserTools: (workstationId: string, orderedIds: string[]) => void;
  resetBrowserTools: (workstationId: string) => void;
  archive: (id: string) => string | null;
  remove: (id: string) => string | null;
  setActive: (id: string) => void;
};

export const useSpaces = create<State>((set, get) => ({
  spaces: [],
  activeId: null,
  hydrated: false,
  unavailableRootIds: [],
  initialActiveIndex: {},

  hydrate: (
    spaces,
    activeId,
    initialActiveIndex = {},
    unavailableRootIds = [],
  ) => {
    const restoredActiveId = spaces.some((space) => space.id === activeId)
      ? activeId
      : (spaces[0]?.id ?? null);
    set({
      spaces,
      activeId: restoredActiveId,
      initialActiveIndex,
      unavailableRootIds,
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
      agentPresets: createDefaultWorkstationAgentPresets(),
      browser: createDefaultWorkstationBrowserState(),
      createdAt: now,
      updatedAt: now,
    };
    const spaces = [...get().spaces, meta];
    set({
      spaces,
      unavailableRootIds: input.root
        ? get().unavailableRootIds.filter((item) => item !== id)
        : [...get().unavailableRootIds, id],
    });
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

  setRoot: async (id, root) => {
    const current = get().spaces;
    if (!current.some((space) => space.id === id)) return;
    const spaces = current.map((space) =>
      space.id === id ? { ...space, root, updatedAt: Date.now() } : space,
    );
    await saveSpacesList(spaces);
    await flushStore();
    set({
      spaces,
      unavailableRootIds: root
        ? get().unavailableRootIds.filter((item) => item !== id)
        : [...new Set([...get().unavailableRootIds, id])],
    });
    setSpaceStatePersistenceBlocked(id, root === null);
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

  updateAgentPreset: (workstationId, presetId, update) => {
    const current = get().spaces;
    const workstation = current.find((space) => space.id === workstationId);
    if (!workstation) return;
    const preset = workstation.agentPresets.find(
      (item) => item.id === presetId,
    );
    if (!preset) return;
    const agentPresets = normalizeWorkstationAgentPresets(
      workstation.agentPresets.map((item) =>
        item.id === presetId ? { ...item, ...update } : item,
      ),
    );
    const spaces = current.map((space) =>
      space.id === workstationId
        ? { ...space, agentPresets, updatedAt: Date.now() }
        : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  addAgentPreset: (workstationId, preset) => {
    const current = get().spaces;
    const workstation = current.find((space) => space.id === workstationId);
    if (!workstation) throw new Error("Workstation is unavailable.");
    if (!isCustomAgentPresetId(preset.id)) {
      throw new Error("Only custom presets can be added.");
    }
    if (workstation.agentPresets.some((item) => item.id === preset.id)) {
      throw new Error("Agent preset already exists.");
    }
    const customCount = workstation.agentPresets.filter((item) =>
      isCustomAgentPresetId(item.id),
    ).length;
    if (customCount >= MAX_CUSTOM_AGENT_PRESETS) {
      throw new Error(
        `A workstation can have at most ${MAX_CUSTOM_AGENT_PRESETS} custom presets.`,
      );
    }
    const validation = validateWorkstationAgentPreset(preset);
    if (!validation.ok) throw new Error(validation.error);
    const agentPresets = [...workstation.agentPresets, validation.preset];
    const spaces = current.map((space) =>
      space.id === workstationId
        ? { ...space, agentPresets, updatedAt: Date.now() }
        : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  removeAgentPreset: (workstationId, presetId) => {
    if (!isCustomAgentPresetId(presetId)) return;
    const current = get().spaces;
    const workstation = current.find((space) => space.id === workstationId);
    if (!workstation) return;
    const agentPresets = workstation.agentPresets.filter(
      (preset) => preset.id !== presetId,
    );
    if (agentPresets.length === workstation.agentPresets.length) return;
    const spaces = current.map((space) =>
      space.id === workstationId
        ? { ...space, agentPresets, updatedAt: Date.now() }
        : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  resetAgentPreset: (workstationId, presetId) => {
    const current = get().spaces;
    const workstation = current.find((space) => space.id === workstationId);
    const fallback = DEFAULT_WORKSTATION_AGENT_PRESETS.find(
      (preset) => preset.id === presetId,
    );
    if (!workstation || !fallback) return;
    const agentPresets = workstation.agentPresets.map((preset) =>
      preset.id === presetId ? { ...fallback } : preset,
    );
    const spaces = current.map((space) =>
      space.id === workstationId
        ? { ...space, agentPresets, updatedAt: Date.now() }
        : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  resetAgentPresets: (workstationId) => {
    const current = get().spaces;
    if (!current.some((space) => space.id === workstationId)) return;
    const spaces = current.map((space) =>
      space.id === workstationId
        ? {
            ...space,
            agentPresets: createDefaultWorkstationAgentPresets(),
            updatedAt: Date.now(),
          }
        : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  setBrowserProfileMode: (workstationId, mode) => {
    const current = get().spaces;
    const workstation = current.find((space) => space.id === workstationId);
    if (!workstation || workstation.browser.profileMode === mode) return;
    const spaces = current.map((space) =>
      space.id === workstationId
        ? {
            ...space,
            browser: { ...space.browser, profileMode: mode },
            updatedAt: Date.now(),
          }
        : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  setBrowserOpenOnWorkstationLaunch: (workstationId, enabled) => {
    const current = get().spaces;
    const workstation = current.find((space) => space.id === workstationId);
    if (
      !workstation ||
      workstation.browser.openOnWorkstationLaunch === enabled
    ) {
      return;
    }
    const spaces = current.map((space) =>
      space.id === workstationId
        ? {
            ...space,
            browser: { ...space.browser, openOnWorkstationLaunch: enabled },
            updatedAt: Date.now(),
          }
        : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  addBrowserTool: (workstationId, input) => {
    const current = get().spaces;
    const workstation = current.find((space) => space.id === workstationId);
    if (!workstation) return null;
    if (workstation.browser.tools.length >= MAX_BROWSER_TOOLS) {
      throw new Error(
        `A workstation can have at most ${MAX_BROWSER_TOOLS} website tools.`,
      );
    }
    const validation = validateBrowserToolInput(input);
    if (!validation.ok) throw new Error(validation.error);
    let id = newBrowserToolId();
    while (workstation.browser.tools.some((tool) => tool.id === id)) {
      id = newBrowserToolId();
    }
    const tool: BrowserTool = { id, ...validation.tool };
    const tools = [...workstation.browser.tools, tool];
    if (browserToolUrlBytes(tools) > MAX_BROWSER_URL_TOTAL_BYTES) {
      throw new Error("The combined website URLs are too long.");
    }
    const spaces = current.map((space) =>
      space.id === workstationId
        ? {
            ...space,
            browser: { ...space.browser, tools },
            updatedAt: Date.now(),
          }
        : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
    return tool;
  },

  updateBrowserTool: (workstationId, toolId, update) => {
    const current = get().spaces;
    const workstation = current.find((space) => space.id === workstationId);
    const existing = workstation?.browser.tools.find(
      (tool) => tool.id === toolId,
    );
    if (!workstation || !existing) return;
    const validation = validateBrowserToolInput({ ...existing, ...update });
    if (!validation.ok) throw new Error(validation.error);
    const tools = workstation.browser.tools.map((tool) =>
      tool.id === toolId ? { id: tool.id, ...validation.tool } : tool,
    );
    if (browserToolUrlBytes(tools) > MAX_BROWSER_URL_TOTAL_BYTES) {
      throw new Error("The combined website URLs are too long.");
    }
    const spaces = current.map((space) =>
      space.id === workstationId
        ? {
            ...space,
            browser: { ...space.browser, tools },
            updatedAt: Date.now(),
          }
        : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  removeBrowserTool: (workstationId, toolId) => {
    const current = get().spaces;
    const workstation = current.find((space) => space.id === workstationId);
    if (!workstation?.browser.tools.some((tool) => tool.id === toolId)) return;
    const tools = workstation.browser.tools.filter(
      (tool) => tool.id !== toolId,
    );
    const spaces = current.map((space) =>
      space.id === workstationId
        ? {
            ...space,
            browser: { ...space.browser, tools },
            updatedAt: Date.now(),
          }
        : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  reorderBrowserTools: (workstationId, orderedIds) => {
    const current = get().spaces;
    const workstation = current.find((space) => space.id === workstationId);
    if (!workstation) return;
    const byId = new Map(
      workstation.browser.tools.map((tool) => [tool.id, tool]),
    );
    const seen = new Set<string>();
    const tools: BrowserTool[] = [];
    for (const id of orderedIds) {
      const tool = byId.get(id);
      if (tool && !seen.has(id)) {
        seen.add(id);
        tools.push(tool);
      }
    }
    for (const tool of workstation.browser.tools) {
      if (!seen.has(tool.id)) tools.push(tool);
    }
    if (
      tools.every((tool, index) => tool === workstation.browser.tools[index])
    ) {
      return;
    }
    const spaces = current.map((space) =>
      space.id === workstationId
        ? {
            ...space,
            browser: { ...space.browser, tools },
            updatedAt: Date.now(),
          }
        : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  resetBrowserTools: (workstationId) => {
    const current = get().spaces;
    if (!current.some((space) => space.id === workstationId)) return;
    const spaces = current.map((space) =>
      space.id === workstationId
        ? {
            ...space,
            browser: { ...space.browser, tools: createDefaultBrowserTools() },
            updatedAt: Date.now(),
          }
        : space,
    );
    set({ spaces });
    void saveSpacesList(spaces);
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
    set({
      spaces,
      activeId,
      initialActiveIndex,
      unavailableRootIds: prev.unavailableRootIds.filter((item) => item !== id),
    });
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
