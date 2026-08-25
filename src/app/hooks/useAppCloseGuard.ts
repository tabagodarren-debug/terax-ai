import { evaluateCloseHazards } from "@/app/hooks/tabCloseGuards";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Tab } from "@/modules/tabs";
import { leafHasForegroundProcess, leafIds } from "@/modules/terminal";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export type AppCloseBlocker = {
  dirtyEditors: number;
  busyTerminal: boolean;
};

type AppCloseSnapshot = {
  dirtyIds: number[];
  leafIds: number[];
};

export async function evaluateAppCloseBlocker(
  capture: () => AppCloseSnapshot,
  isBusy: (leafId: number) => Promise<boolean>,
  confirmRunningTerminal: boolean,
): Promise<AppCloseBlocker> {
  const hazards = await evaluateCloseHazards(
    capture,
    isBusy,
    confirmRunningTerminal,
  );
  return {
    dirtyEditors: hazards.dirtyIds.length,
    busyTerminal: hazards.busyLeafIds.length > 0,
  };
}

/**
 * The opt-out only covers running processes, so it stays hidden whenever the
 * same prompt is also the last warning before discarding unsaved buffers.
 */
export function canOptOutOfAppClosePrompt(blocker: AppCloseBlocker): boolean {
  return blocker.busyTerminal && blocker.dirtyEditors === 0;
}

export type AppCloseGuardOptions = {
  saveAll?: () => Promise<boolean>;
  prepareClose?: () => Promise<void>;
};

export function useAppCloseGuard(
  tabsRef: RefObject<Tab[]>,
  options: AppCloseGuardOptions = {},
) {
  const [pendingAppClose, setPendingAppClose] =
    useState<AppCloseBlocker | null>(null);
  const [appCloseSaving, setAppCloseSaving] = useState(false);
  const [appCloseSaveError, setAppCloseSaveError] = useState<string | null>(
    null,
  );
  const forceClose = useRef(false);
  const closeRequestRef = useRef(0);
  const saveAllRef = useRef(options.saveAll);
  saveAllRef.current = options.saveAll;
  const prepareCloseRef = useRef(options.prepareClose);
  prepareCloseRef.current = options.prepareClose;

  const prepareClose = useCallback(async (): Promise<boolean> => {
    try {
      await prepareCloseRef.current?.();
      return true;
    } catch (error) {
      setAppCloseSaveError(
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }, []);

  const capture = useCallback((): AppCloseSnapshot => {
    const tabs = tabsRef.current;
    return {
      dirtyIds: tabs
        .filter((tab) => tab.kind === "editor" && tab.dirty)
        .map((tab) => tab.id),
      leafIds: tabs.flatMap((tab) =>
        tab.kind === "terminal" ? leafIds(tab.paneTree) : [],
      ),
    };
  }, [tabsRef]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (forceClose.current) return;
        event.preventDefault();
        const requestId = ++closeRequestRef.current;
        const blocker = await evaluateAppCloseBlocker(
          capture,
          leafHasForegroundProcess,
          usePreferencesStore.getState().confirmCloseRunningTerminal,
        );
        if (disposed || requestId !== closeRequestRef.current) return;
        if (blocker.dirtyEditors > 0 || blocker.busyTerminal) {
          setAppCloseSaveError(null);
          setPendingAppClose(blocker);
        } else {
          if (!(await prepareClose())) {
            setPendingAppClose(blocker);
            return;
          }
          forceClose.current = true;
          void getCurrentWindow().close();
        }
      })
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [capture, prepareClose]);

  const confirmAppClose = useCallback(async () => {
    closeRequestRef.current += 1;
    setPendingAppClose(null);
    await prepareClose();
    forceClose.current = true;
    void getCurrentWindow().close();
  }, [prepareClose]);

  const saveAllAndClose = useCallback(async () => {
    const saveAll = saveAllRef.current;
    if (!saveAll || appCloseSaving) return;
    setAppCloseSaving(true);
    setAppCloseSaveError(null);
    try {
      const saved = await saveAll();
      if (!saved) {
        const dirtyEditors = capture().dirtyIds.length;
        setAppCloseSaveError(
          dirtyEditors === 1
            ? "1 file could not be saved. Resolve it before quitting."
            : dirtyEditors > 1
              ? `${dirtyEditors} files could not be saved. Resolve them before quitting.`
              : "Save All did not complete. Resolve the save error before quitting.",
        );
        setPendingAppClose((current) =>
          current ? { ...current, dirtyEditors } : current,
        );
        return;
      }
      if (!(await prepareClose())) return;
      closeRequestRef.current += 1;
      setPendingAppClose(null);
      forceClose.current = true;
      void getCurrentWindow().close();
    } catch (error) {
      setAppCloseSaveError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setAppCloseSaving(false);
    }
  }, [appCloseSaving, capture, prepareClose]);

  const cancelAppClose = useCallback(() => {
    closeRequestRef.current += 1;
    setPendingAppClose(null);
    setAppCloseSaveError(null);
  }, []);

  return {
    pendingAppClose,
    appCloseSaving,
    appCloseSaveError,
    saveAllAndClose: options.saveAll ? saveAllAndClose : undefined,
    confirmAppClose,
    cancelAppClose,
  };
}
