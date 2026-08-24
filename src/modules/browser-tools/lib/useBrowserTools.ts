import type {
  BrowserToolLauncherPendingAction,
  BrowserToolLauncherProps,
} from "@/modules/browser-tools/components/BrowserToolLauncher";
import {
  activeBrowserProfileId,
  MAX_BROWSER_TOOLS,
} from "@/modules/browser-tools/lib/browserState";
import {
  detectBrowsers,
  getBrowserProfileStatus,
  launchBrowser,
  openBrowserProfileFolder,
  resetBrowserProfile,
  validateBrowserExecutable,
} from "@/modules/browser-tools/lib/native";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { SpaceMeta } from "@/modules/spaces";
import { useSpaces } from "@/modules/spaces";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type BrowserView = BrowserToolLauncherProps["browser"];
type ProfileView = BrowserToolLauncherProps["profile"];

export function browserToolsNativeDemand({
  preferencesHydrated,
  spacesLoading,
  menuOpen,
  autoOpenEnabled,
}: {
  preferencesHydrated: boolean;
  spacesLoading: boolean;
  menuOpen: boolean;
  autoOpenEnabled: boolean;
}): boolean {
  return preferencesHydrated && !spacesLoading && (menuOpen || autoOpenEnabled);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useBrowserTools(
  workstation: SpaceMeta | null,
  loading: boolean,
): BrowserToolLauncherProps {
  const browserId = usePreferencesStore((state) => state.preferredBrowserId);
  const preferencesHydrated = usePreferencesStore((state) => state.hydrated);
  const executableOverrides = usePreferencesStore(
    (state) => state.browserExecutableOverrides,
  );
  const executableOverride = executableOverrides[browserId] ?? null;
  const profileId = workstation
    ? activeBrowserProfileId(workstation.browser)
    : null;
  const contextKey = `${workstation?.id ?? "none"}:${browserId}:${profileId ?? "none"}`;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;
  const observedWorkstationIdRef = useRef<string | null>(null);
  const pendingAutoOpenRef = useRef<string | null>(null);

  const [browser, setBrowser] = useState<BrowserView>({
    id: browserId,
    name: browserId === "chrome" ? "Google Chrome" : "Microsoft Edge",
    status: "loading",
  });
  const [profile, setProfile] = useState<ProfileView>({
    activity: "loading",
  });
  const [pendingAction, setPendingAction] =
    useState<BrowserToolLauncherPendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [browserRefreshVersion, setBrowserRefreshVersion] = useState(0);
  const [profileRefreshVersion, setProfileRefreshVersion] = useState(0);
  const effectiveLoading = loading || !preferencesHydrated;
  const nativeDemand = browserToolsNativeDemand({
    preferencesHydrated,
    spacesLoading: loading,
    menuOpen,
    autoOpenEnabled: Boolean(workstation?.browser.openOnWorkstationLaunch),
  });

  useEffect(() => {
    void browserRefreshVersion;
    let cancelled = false;
    const name = browserId === "chrome" ? "Google Chrome" : "Microsoft Edge";
    setBrowser({ id: browserId, name, status: "loading" });
    if (!nativeDemand) return;

    void (async () => {
      const [detectionResult, overrideResult] = await Promise.allSettled([
        detectBrowsers(),
        executableOverride
          ? validateBrowserExecutable(browserId, executableOverride)
          : Promise.resolve(null),
      ]);
      if (cancelled) return;

      if (executableOverride) {
        if (overrideResult.status === "fulfilled" && overrideResult.value) {
          setBrowser({
            id: browserId,
            name,
            status: "available",
            resolvedPath: overrideResult.value.path,
          });
        } else {
          setBrowser({
            id: browserId,
            name,
            status: "moved",
            resolvedPath: executableOverride,
            message:
              overrideResult.status === "rejected"
                ? errorMessage(overrideResult.reason)
                : "The configured browser executable is unavailable.",
          });
        }
        return;
      }

      if (detectionResult.status === "rejected") {
        setBrowser({
          id: browserId,
          name,
          status: "error",
          message: errorMessage(detectionResult.reason),
        });
        return;
      }
      const detection = detectionResult.value.find(
        (candidate) => candidate.id === browserId,
      );
      setBrowser(
        detection?.available
          ? {
              id: browserId,
              name: detection.name,
              status: "available",
              resolvedPath: detection.resolvedPath,
            }
          : {
              id: browserId,
              name: detection?.name ?? name,
              status: "unavailable",
              message: `${name} was not found.`,
            },
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [browserId, browserRefreshVersion, executableOverride, nativeDemand]);

  useEffect(() => {
    void profileRefreshVersion;
    let cancelled = false;
    if (!profileId || !nativeDemand) {
      setProfile({
        activity: profileId ? "loading" : "error",
        ...(profileId
          ? {}
          : { message: "Select a workstation to use browser tools." }),
      });
      return;
    }
    setProfile({ activity: "loading" });
    void getBrowserProfileStatus({ browserId, profileId })
      .then((status) => {
        if (cancelled) return;
        setProfile({
          activity: status.activity,
          exists: status.exists,
          profilePath: status.profilePath,
        });
      })
      .catch((profileError) => {
        if (cancelled) return;
        setProfile({
          activity: "error",
          message: errorMessage(profileError),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [browserId, nativeDemand, profileId, profileRefreshVersion]);

  useEffect(() => {
    void contextKey;
    setError(null);
    setNotice(null);
    setPendingAction(null);
  }, [contextKey]);

  const refresh = useCallback(() => {
    setBrowserRefreshVersion((value) => value + 1);
    setProfileRefreshVersion((value) => value + 1);
  }, []);

  const runNative = useCallback(
    async (
      action: BrowserToolLauncherPendingAction,
      operation: () => Promise<string>,
    ) => {
      const startedIn = contextKey;
      setPendingAction(action);
      setError(null);
      setNotice(null);
      try {
        const message = await operation();
        if (contextKeyRef.current === startedIn) {
          setNotice(message);
          setProfileRefreshVersion((value) => value + 1);
        }
      } catch (operationError) {
        const message = errorMessage(operationError);
        if (action === "launch-all" || action.startsWith("launch-tool:")) {
          toast.error("Could not open browser tools", { description: message });
        }
        if (contextKeyRef.current === startedIn) {
          setError(message);
        }
      } finally {
        if (contextKeyRef.current === startedIn) setPendingAction(null);
      }
    },
    [contextKey],
  );

  const currentRequest = useCallback(() => {
    if (!workstation) throw new Error("Select a workstation first.");
    const current = useSpaces
      .getState()
      .spaces.find((candidate) => candidate.id === workstation.id);
    if (!current) throw new Error("The active workstation is unavailable.");
    const preferred = usePreferencesStore.getState().preferredBrowserId;
    return {
      browserId: preferred,
      executablePath:
        usePreferencesStore.getState().browserExecutableOverrides[preferred] ??
        null,
      profileId: activeBrowserProfileId(current.browser),
      workstation: current,
    };
  }, [workstation]);

  const launchUrls = useCallback(
    (urls: string[], action: BrowserToolLauncherPendingAction) => {
      void runNative(action, async () => {
        const request = currentRequest();
        const result = await launchBrowser({
          browserId: request.browserId,
          executablePath: request.executablePath,
          profileId: request.profileId,
          urls,
        });
        return `${result.launchedUrlCount} website${result.launchedUrlCount === 1 ? "" : "s"} opened in ${request.browserId === "chrome" ? "Chrome" : "Edge"}.`;
      });
    },
    [currentRequest, runNative],
  );

  useEffect(() => {
    const workstationId = workstation?.id ?? null;
    if (observedWorkstationIdRef.current === workstationId) return;
    observedWorkstationIdRef.current = workstationId;
    pendingAutoOpenRef.current = workstation?.browser.openOnWorkstationLaunch
      ? workstationId
      : null;
  }, [workstation?.browser.openOnWorkstationLaunch, workstation?.id]);

  useEffect(() => {
    const activeWorkstation = workstation;
    const workstationId = activeWorkstation?.id ?? null;
    if (
      !activeWorkstation ||
      !workstationId ||
      pendingAutoOpenRef.current !== workstationId ||
      loading ||
      !preferencesHydrated ||
      pendingAction !== null
    ) {
      return;
    }
    if (!activeWorkstation.browser.openOnWorkstationLaunch) {
      pendingAutoOpenRef.current = null;
      return;
    }
    if (activeWorkstation.browser.tools.length === 0) {
      pendingAutoOpenRef.current = null;
      return;
    }
    if (browser.status !== "available") return;

    pendingAutoOpenRef.current = null;
    launchUrls(
      activeWorkstation.browser.tools.map((tool) => tool.url),
      "launch-all",
    );
  }, [
    browser.status,
    launchUrls,
    loading,
    pendingAction,
    preferencesHydrated,
    workstation,
  ]);

  const mutate = useCallback((operation: () => void) => {
    setError(null);
    setNotice(null);
    try {
      operation();
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    }
  }, []);

  return useMemo(
    () => ({
      contextKey,
      tools: workstation?.browser.tools ?? [],
      profileMode: workstation?.browser.profileMode ?? "workstation",
      openOnWorkstationLaunch:
        workstation?.browser.openOnWorkstationLaunch ?? false,
      browser,
      profile,
      loading: effectiveLoading,
      error,
      notice,
      pendingAction,
      maxTools: MAX_BROWSER_TOOLS,
      onRetry: refresh,
      onMenuOpenChange: (open) => {
        setMenuOpen(open);
        if (open) {
          setBrowserRefreshVersion((value) => value + 1);
          setProfileRefreshVersion((value) => value + 1);
        }
      },
      onOpenBrowserSettings: () => void openSettingsWindow("browser"),
      onLaunchAll: () =>
        launchUrls(
          workstation?.browser.tools.map((tool) => tool.url) ?? [],
          "launch-all",
        ),
      onLaunchTool: (tool) => launchUrls([tool.url], `launch-tool:${tool.id}`),
      onProfileModeChange: (mode) => {
        if (!workstation) return;
        useSpaces.getState().setBrowserProfileMode(workstation.id, mode);
      },
      onOpenOnWorkstationLaunchChange: (enabled) => {
        if (!workstation) return;
        useSpaces
          .getState()
          .setBrowserOpenOnWorkstationLaunch(workstation.id, enabled);
      },
      onAddTool: (draft) =>
        mutate(() => {
          if (!workstation) throw new Error("Select a workstation first.");
          useSpaces.getState().addBrowserTool(workstation.id, draft);
        }),
      onUpdateTool: (id, draft) =>
        mutate(() => {
          if (!workstation) throw new Error("Select a workstation first.");
          useSpaces.getState().updateBrowserTool(workstation.id, id, draft);
        }),
      onRemoveTool: (id) =>
        mutate(() => {
          if (!workstation) return;
          useSpaces.getState().removeBrowserTool(workstation.id, id);
        }),
      onReorderTools: (ids) => {
        if (!workstation) return;
        useSpaces.getState().reorderBrowserTools(workstation.id, ids);
      },
      onOpenProfileFolder: () => {
        void runNative("open-profile-folder", async () => {
          const request = currentRequest();
          await openBrowserProfileFolder({
            browserId: request.browserId,
            profileId: request.profileId,
          });
          return "Managed browser profile folder opened.";
        });
      },
      onResetProfile: () => {
        void runNative("reset-profile", async () => {
          const request = currentRequest();
          const result = await resetBrowserProfile({
            browserId: request.browserId,
            profileId: request.profileId,
            confirmed: true,
          });
          if (result.cleanupPending) {
            throw new Error(
              "The profile was reset, but old data cleanup is still pending.",
            );
          }
          return "Managed browser profile reset.";
        });
      },
      className: "max-h-[min(680px,calc(100vh-32px))]",
    }),
    [
      browser,
      contextKey,
      currentRequest,
      effectiveLoading,
      error,
      launchUrls,
      mutate,
      notice,
      pendingAction,
      profile,
      refresh,
      runNative,
      workstation,
    ],
  );
}
