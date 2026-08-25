import { createDefaultWorkstationAgentPresets } from "@/modules/agents/lib/presets";
import { createDefaultWorkstationBrowserState } from "@/modules/browser-tools/lib/browserState";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Tab } from "@/modules/tabs";
import { DEFAULT_SPACE_ID } from "@/modules/tabs/lib/useTabs";
import { parseWorkspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace";
import { useEffect, useRef } from "react";
import { activeSpaceEnv, freshTabCwd } from "./activeSpace";
import { freshTerminalTab, hydrateTabs } from "./serialize";
import {
  loadAll,
  type SpaceMeta,
  saveActiveId,
  saveSpacesList,
  setSpaceStatePersistenceBlocked,
} from "./store";
import { useSpaces } from "./useSpaces";
import { authorizeWorkstationRoot } from "./workstationNative";

type Params = {
  ready: boolean;
  launchCwd: string | null;
  home: string | null;
  allocId: () => number;
  replaceTabs: (tabs: Tab[], activeId: number) => void;
  markBooted: () => void;
  setActiveSpaceForNewTabs: (id: string) => void;
  adoptWorkspaceEnv: (env: WorkspaceEnv) => Promise<string | null>;
};

export async function authorizeSavedRoots(
  spaces: readonly SpaceMeta[],
): Promise<Map<string, string>> {
  const roots = new Map<string, string>();
  await Promise.all(
    spaces.map(async (space) => {
      if (!space.root) return;
      try {
        await authorizeWorkstationRoot(space.root, space.env);
        roots.set(space.id, space.root);
      } catch {
        // Keep the device mapping intact so the user can relocate it later.
      }
    }),
  );
  for (const space of spaces) {
    setSpaceStatePersistenceBlocked(space.id, !roots.has(space.id));
  }
  return roots;
}

export async function restoreSavedSpaceTabs(
  spaceId: string,
  root: string,
  allocId: () => number,
): Promise<{ tabs: Tab[]; activeTabIndex: number }> {
  const { states } = await loadAll();
  const state = states.get(spaceId);
  if (!state) {
    return {
      tabs: [freshTerminalTab(spaceId, root, allocId)],
      activeTabIndex: 0,
    };
  }
  const tabs = hydrateTabs(state.tabs, spaceId, root, allocId);
  return {
    tabs: tabs.length > 0 ? tabs : [freshTerminalTab(spaceId, root, allocId)],
    activeTabIndex: tabs.length > 0 ? state.activeTabIndex : 0,
  };
}

export function useSpacesBoot({
  ready,
  launchCwd,
  home,
  allocId,
  replaceTabs,
  markBooted,
  setActiveSpaceForNewTabs,
  adoptWorkspaceEnv,
}: Params) {
  const done = useRef(false);

  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;

    void (async () => {
      try {
        const { spaces, activeId, states } = await loadAll();

        if (spaces.length === 0) {
          const root = launchCwd ?? home ?? null;
          // Hydrate prefs before reading the saved workspace env.
          await usePreferencesStore
            .getState()
            .init()
            .catch(() => {});
          const meta: SpaceMeta = {
            id: DEFAULT_SPACE_ID,
            name: "Default",
            root,
            env: parseWorkspaceScopeKey(
              usePreferencesStore.getState().defaultWorkspaceEnv,
            ),
            agentPresets: createDefaultWorkstationAgentPresets(),
            browser: createDefaultWorkstationBrowserState(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await saveSpacesList([meta]);
          await saveActiveId(DEFAULT_SPACE_ID);
          setActiveSpaceForNewTabs(DEFAULT_SPACE_ID);
          useSpaces.getState().hydrate([meta], DEFAULT_SPACE_ID);
          return;
        }

        const authorizedRoots = await authorizeSavedRoots(spaces);
        const restored: Tab[] = [];
        for (const space of spaces) {
          const st = states.get(space.id);
          if (!st) continue;
          restored.push(
            ...hydrateTabs(
              st.tabs,
              space.id,
              authorizedRoots.get(space.id) ?? null,
              allocId,
            ),
          );
        }

        const active =
          activeId && spaces.some((s) => s.id === activeId)
            ? activeId
            : spaces[0].id;
        if (active !== activeId) await saveActiveId(active);
        setActiveSpaceForNewTabs(active);

        // Apply the space's env+home before the fresh-tab fallback and spawns
        // below; env is set synchronously so cwd resolution picks WSL vs local.
        const env = activeSpaceEnv(spaces, active);
        const restoredHome = await adoptWorkspaceEnv(env);

        // Active space must never be empty, else its tab list shows nothing.
        if (!restored.some((t) => t.spaceId === active)) {
          const cwd =
            authorizedRoots.get(active) ??
            freshTabCwd(env, restoredHome, launchCwd, home);
          restored.push(freshTerminalTab(active, cwd, allocId));
        }

        const initialActiveIndex: Record<string, number> = {};
        for (const [id, st] of states)
          initialActiveIndex[id] = st.activeTabIndex;
        const unavailableRootIds = spaces
          .filter((space) => !space.root || !authorizedRoots.has(space.id))
          .map((space) => space.id);
        useSpaces
          .getState()
          .hydrate(spaces, active, initialActiveIndex, unavailableRootIds);

        const inActive = restored.filter((t) => t.spaceId === active);
        const idx = states.get(active)?.activeTabIndex ?? 0;
        const activeTab = inActive[idx] ?? inActive[0] ?? restored[0];
        replaceTabs(restored, activeTab.id);
      } catch (e) {
        console.error("[terax] spaces boot failed:", e);
      } finally {
        markBooted();
      }
    })();
  }, [
    ready,
    launchCwd,
    home,
    allocId,
    replaceTabs,
    markBooted,
    setActiveSpaceForNewTabs,
    adoptWorkspaceEnv,
  ]);
}
