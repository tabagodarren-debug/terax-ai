import type { Tab } from "@/modules/tabs";
import { useCallback, useEffect, useRef } from "react";
import { isSerializableTab, serializeTabs } from "./serialize";
import { flushStore, isSpaceStatePersistenceBlocked, saveState } from "./store";
import { useSpaces } from "./useSpaces";

const DEBOUNCE_MS = 3000;

type Snapshot = { tabs: Tab[]; activeId: number; activeSpaceId: string };

type Params = Snapshot & {
  /** Gate writes until boot hydration finished, so restore never round-trips. */
  enabled: boolean;
};

type LastWrite = { json: string; activeTabIndex: number };

export function useSpacePersistence({
  tabs,
  activeId,
  activeSpaceId,
  enabled,
}: Params) {
  const last = useRef<Map<string, LastWrite>>(new Map());
  const seeded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const persistenceSuppressed = useRef(false);
  const latest = useRef<Snapshot>({ tabs, activeId, activeSpaceId });
  latest.current = { tabs, activeId, activeSpaceId };

  // Seed each space's last-known active index from disk so the first flush
  // preserves it for spaces the user never opens (empty json forces one write
  // with the correct index rather than clobbering it to 0).
  if (enabled && !seeded.current) {
    seeded.current = true;
    for (const [id, idx] of Object.entries(
      useSpaces.getState().initialActiveIndex,
    )) {
      last.current.set(id, { json: "", activeTabIndex: idx });
    }
  }

  const flush = useCallback(async (snap: Snapshot): Promise<boolean> => {
    const groups = new Map<string, Tab[]>();
    for (const t of snap.tabs) {
      const arr = groups.get(t.spaceId);
      if (arr) arr.push(t);
      else groups.set(t.spaceId, [t]);
    }

    const roots = new Map(
      useSpaces.getState().spaces.map((space) => [space.id, space.root]),
    );
    const writes: Array<{
      spaceId: string;
      value: LastWrite;
      tabs: ReturnType<typeof serializeTabs>;
      activeTabIndex: number;
    }> = [];
    for (const [spaceId, group] of groups) {
      if (isSpaceStatePersistenceBlocked(spaceId)) continue;
      const serialized = serializeTabs(group, roots.get(spaceId) ?? null);
      const prev = last.current.get(spaceId);
      let activeTabIndex = prev?.activeTabIndex ?? 0;
      if (spaceId === snap.activeSpaceId) {
        const idx = group
          .filter(isSerializableTab)
          .findIndex((t) => t.id === snap.activeId);
        if (idx >= 0) activeTabIndex = idx;
      }
      const json = JSON.stringify(serialized);
      if (
        prev &&
        prev.json === json &&
        prev.activeTabIndex === activeTabIndex
      ) {
        continue;
      }
      writes.push({
        spaceId,
        value: { json, activeTabIndex },
        tabs: serialized,
        activeTabIndex,
      });
    }
    await Promise.all(
      writes.map((write) =>
        saveState(write.spaceId, {
          tabs: write.tabs,
          activeTabIndex: write.activeTabIndex,
        }),
      ),
    );
    for (const write of writes) last.current.set(write.spaceId, write.value);
    return writes.length > 0;
  }, []);

  const enqueueFlush = useCallback(
    (snap: Snapshot, forceDurable = false): Promise<void> => {
      if (persistenceSuppressed.current) return Promise.resolve();
      const operation = writeChain.current
        .catch(() => {})
        .then(async () => {
          const wroteSnapshot = await flush(snap);
          if (wroteSnapshot || forceDurable) await flushStore();
        });
      writeChain.current = operation;
      return operation;
    },
    [flush],
  );

  const flushNow = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    return enqueueFlush(latest.current, true);
  }, [enqueueFlush]);

  const clearSnapshots = useCallback((spaceIds: readonly string[]) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    persistenceSuppressed.current = true;
    const ids = [...new Set(spaceIds)];
    const operation = writeChain.current
      .catch(() => {})
      .then(async () => {
        await Promise.all(
          ids.map((id) => saveState(id, { tabs: [], activeTabIndex: 0 })),
        );
        await flushStore();
        for (const id of ids) {
          last.current.set(id, { json: "[]", activeTabIndex: 0 });
        }
      });
    writeChain.current = operation;
    return operation;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    persistenceSuppressed.current = false;
    const snap: Snapshot = { tabs, activeId, activeSpaceId };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void enqueueFlush(snap).catch((error) => {
        console.error("[afflow] workspace snapshot write failed:", error);
      });
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tabs, activeId, activeSpaceId, enabled, enqueueFlush]);

  useEffect(() => {
    if (!enabled) return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        void enqueueFlush(latest.current).catch(() => {});
      }
    };
    const onLeave = () => void enqueueFlush(latest.current).catch(() => {});
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("beforeunload", onLeave);
      void enqueueFlush(latest.current).catch(() => {});
    };
  }, [enabled, enqueueFlush]);

  return { flushNow, clearSnapshots };
}
