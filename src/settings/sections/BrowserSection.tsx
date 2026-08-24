import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  detectBrowsers,
  type BrowserDetection,
  type BrowserExecutable,
  validateBrowserExecutable,
} from "@/modules/browser-tools/lib/native";
import type { BrowserId } from "@/modules/browser-tools/lib/types";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setBrowserExecutableOverride,
  setPreferredBrowserId,
} from "@/modules/settings/store";
import { SectionHeader } from "@/settings/components/SectionHeader";
import {
  Alert02Icon,
  BrowserIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  FolderOpenIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";

const BROWSERS: ReadonlyArray<{ id: BrowserId; name: string }> = [
  { id: "chrome", name: "Google Chrome" },
  { id: "edge", name: "Microsoft Edge" },
];

export type BrowserSettingsNative = {
  detectBrowsers: () => Promise<BrowserDetection[]>;
  pickExecutable: (browserId: BrowserId) => Promise<string | null>;
  validateExecutable: (
    browserId: BrowserId,
    path: string,
  ) => Promise<BrowserExecutable>;
};

export type OverrideCheck =
  | { state: "validating"; path: string }
  | { state: "valid"; path: string }
  | { state: "invalid"; path: string; error: string };

const DEFAULT_NATIVE: BrowserSettingsNative = {
  detectBrowsers,
  async pickExecutable(browserId) {
    const browser = BROWSERS.find((candidate) => candidate.id === browserId);
    const selected = await open({
      title: `Select ${browser?.name ?? "browser"} executable`,
      directory: false,
      multiple: false,
      filters: [{ name: "Windows executable", extensions: ["exe"] }],
    });
    return typeof selected === "string" ? selected : null;
  },
  validateExecutable: validateBrowserExecutable,
};

export type BrowserSettingsViewProps = {
  preferredBrowserId: BrowserId;
  detections: BrowserDetection[] | null;
  overrideChecks: Partial<Record<BrowserId, OverrideCheck>>;
  loading: boolean;
  detectionError: string | null;
  actionErrors: Partial<Record<BrowserId, string>>;
  busyBrowserId: BrowserId | null;
  onPreferredBrowserChange: (browserId: BrowserId) => void;
  onChooseExecutable: (browserId: BrowserId) => void;
  onClearOverride: (browserId: BrowserId) => void;
  onRefresh: () => void;
};

export function BrowserSection({
  native = DEFAULT_NATIVE,
}: {
  native?: BrowserSettingsNative;
} = {}) {
  const preferredBrowserId = usePreferencesStore(
    (state) => state.preferredBrowserId,
  );
  const browserExecutableOverrides = usePreferencesStore(
    (state) => state.browserExecutableOverrides,
  );
  const [detections, setDetections] = useState<BrowserDetection[] | null>(null);
  const [overrideChecks, setOverrideChecks] = useState<
    Partial<Record<BrowserId, OverrideCheck>>
  >({});
  const [loading, setLoading] = useState(true);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<
    Partial<Record<BrowserId, string>>
  >({});
  const [busyBrowserId, setBusyBrowserId] = useState<BrowserId | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetectionError(null);
    setOverrideChecks(
      Object.fromEntries(
        BROWSERS.flatMap(({ id }) => {
          const path = browserExecutableOverrides[id];
          return path ? [[id, { state: "validating", path }]] : [];
        }),
      ) as Partial<Record<BrowserId, OverrideCheck>>,
    );

    const detectionTask = Promise.resolve().then(native.detectBrowsers);
    const validationTasks = BROWSERS.map(async ({ id }) => {
      const path = browserExecutableOverrides[id];
      if (!path) return [id, null] as const;
      try {
        const executable = await native.validateExecutable(id, path);
        if (executable.browserId !== id || !executable.path) {
          throw new Error(
            "The selected executable returned an invalid result.",
          );
        }
        return [id, { state: "valid", path: executable.path }] as const;
      } catch (error) {
        return [
          id,
          { state: "invalid", path, error: errorMessage(error) },
        ] as const;
      }
    });

    const refresh = async (_requestVersion: number) => {
      const [detectionResult] = await Promise.allSettled([detectionTask]);
      const validationResults = await Promise.all(validationTasks);
      if (cancelled) return;
      if (detectionResult.status === "fulfilled") {
        setDetections(normalizeDetections(detectionResult.value));
      } else {
        setDetections(null);
        setDetectionError(errorMessage(detectionResult.reason));
      }

      const checks: Partial<Record<BrowserId, OverrideCheck>> = {};
      for (const [browserId, check] of validationResults) {
        if (check) checks[browserId] = check;
      }
      setOverrideChecks(checks);
      setLoading(false);
    };

    void refresh(refreshVersion);

    return () => {
      cancelled = true;
    };
  }, [browserExecutableOverrides, native, refreshVersion]);

  const chooseExecutable = useCallback(
    async (browserId: BrowserId) => {
      setActionErrors((current) => ({ ...current, [browserId]: undefined }));
      try {
        const path = await native.pickExecutable(browserId);
        if (!path) return;
        setBusyBrowserId(browserId);
        const executable = await native.validateExecutable(browserId, path);
        if (executable.browserId !== browserId || !executable.path) {
          throw new Error(
            "The selected executable returned an invalid result.",
          );
        }
        await setBrowserExecutableOverride(browserId, executable.path);
      } catch (error) {
        setActionErrors((current) => ({
          ...current,
          [browserId]: errorMessage(error),
        }));
      } finally {
        setBusyBrowserId(null);
      }
    },
    [native],
  );

  const clearOverride = useCallback(async (browserId: BrowserId) => {
    setActionErrors((current) => ({ ...current, [browserId]: undefined }));
    setBusyBrowserId(browserId);
    try {
      await setBrowserExecutableOverride(browserId, null);
    } catch (error) {
      setActionErrors((current) => ({
        ...current,
        [browserId]: errorMessage(error),
      }));
    } finally {
      setBusyBrowserId(null);
    }
  }, []);

  const changePreferredBrowser = useCallback(async (browserId: BrowserId) => {
    try {
      await setPreferredBrowserId(browserId);
    } catch (error) {
      setActionErrors((current) => ({
        ...current,
        [browserId]: errorMessage(error),
      }));
    }
  }, []);

  return (
    <BrowserSettingsView
      preferredBrowserId={preferredBrowserId}
      detections={detections}
      overrideChecks={overrideChecks}
      loading={loading}
      detectionError={detectionError}
      actionErrors={actionErrors}
      busyBrowserId={busyBrowserId}
      onPreferredBrowserChange={(browserId) => {
        void changePreferredBrowser(browserId);
      }}
      onChooseExecutable={(browserId) => {
        void chooseExecutable(browserId);
      }}
      onClearOverride={(browserId) => {
        void clearOverride(browserId);
      }}
      onRefresh={() => setRefreshVersion((version) => version + 1)}
    />
  );
}

export function BrowserSettingsView({
  preferredBrowserId,
  detections,
  overrideChecks,
  loading,
  detectionError,
  actionErrors,
  busyBrowserId,
  onPreferredBrowserChange,
  onChooseExecutable,
  onClearOverride,
  onRefresh,
}: BrowserSettingsViewProps) {
  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Browser"
          description="Choose the external browser Afflow uses for workstation tools."
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh browser detection"
          title="Refresh browser detection"
          disabled={loading}
          onClick={onRefresh}
        >
          <HugeiconsIcon icon={Refresh01Icon} size={14} strokeWidth={1.75} />
        </Button>
      </div>

      <section className="flex flex-col gap-2">
        <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
          Preferred browser
        </span>
        <ToggleGroup
          type="single"
          value={preferredBrowserId}
          variant="outline"
          aria-label="Preferred browser"
          onValueChange={(value) => {
            if (value === "chrome" || value === "edge") {
              onPreferredBrowserChange(value);
            }
          }}
        >
          {BROWSERS.map((browser) => (
            <ToggleGroupItem
              key={browser.id}
              value={browser.id}
              aria-label={browser.name}
              className="h-8 min-w-32 gap-1.5 text-[11.5px]"
            >
              <HugeiconsIcon icon={BrowserIcon} size={13} strokeWidth={1.75} />
              {browser.name.replace("Google ", "").replace("Microsoft ", "")}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>

      <section className="flex flex-col gap-2" aria-busy={loading}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
            Browser executables
          </span>
          {loading ? (
            <span className="text-[10.5px] text-muted-foreground">
              Checking browsers...
            </span>
          ) : null}
        </div>

        {detectionError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive"
          >
            <HugeiconsIcon
              icon={Alert02Icon}
              size={13}
              strokeWidth={1.75}
              className="mt-0.5 shrink-0"
            />
            <span className="min-w-0 flex-1">
              Browser detection failed. {detectionError}
            </span>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={onRefresh}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {BROWSERS.map((browser) => (
          <BrowserExecutableRow
            key={browser.id}
            browser={browser}
            detection={
              detections?.find((candidate) => candidate.id === browser.id) ??
              null
            }
            overrideCheck={overrideChecks[browser.id] ?? null}
            actionError={actionErrors[browser.id] ?? null}
            busy={busyBrowserId === browser.id}
            loading={loading}
            onChoose={() => onChooseExecutable(browser.id)}
            onClear={() => onClearOverride(browser.id)}
          />
        ))}
      </section>
    </div>
  );
}

function BrowserExecutableRow({
  browser,
  detection,
  overrideCheck,
  actionError,
  busy,
  loading,
  onChoose,
  onClear,
}: {
  browser: { id: BrowserId; name: string };
  detection: BrowserDetection | null;
  overrideCheck: OverrideCheck | null;
  actionError: string | null;
  busy: boolean;
  loading: boolean;
  onChoose: () => void;
  onClear: () => void;
}) {
  const presentation = browserPresentation(detection, overrideCheck, loading);
  const hasOverride = overrideCheck !== null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/50">
            <HugeiconsIcon icon={BrowserIcon} size={15} strokeWidth={1.5} />
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12.5px] font-medium">{browser.name}</span>
              <Badge
                variant={
                  presentation.kind === "error" ? "destructive" : "outline"
                }
                className="h-4.5 px-1.5 text-[9.5px]"
              >
                {presentation.kind === "available" ? (
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    size={10}
                    strokeWidth={2}
                  />
                ) : presentation.kind === "error" ? (
                  <HugeiconsIcon icon={Alert02Icon} size={10} strokeWidth={2} />
                ) : null}
                {presentation.label}
              </Badge>
            </div>
            <span
              className="max-w-96 truncate font-mono text-[10px] text-muted-foreground"
              title={presentation.path ?? undefined}
            >
              {presentation.path ?? presentation.detail}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={onChoose}
          >
            <HugeiconsIcon icon={FolderOpenIcon} size={12} strokeWidth={1.75} />
            {busy ? "Validating..." : hasOverride ? "Change" : "Choose .exe"}
          </Button>
          {hasOverride ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              disabled={busy}
              aria-label={`Clear ${browser.name} executable override`}
              title="Use detected installation"
              onClick={onClear}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
            </Button>
          ) : null}
        </div>
      </div>
      {presentation.error || actionError ? (
        <p role="alert" className="text-[10.5px] text-destructive">
          {actionError ?? presentation.error}
        </p>
      ) : null}
    </div>
  );
}

export type BrowserPresentation = {
  kind: "available" | "unavailable" | "loading" | "error";
  label: string;
  path: string | null;
  detail: string;
  error: string | null;
};

export function browserPresentation(
  detection: BrowserDetection | null,
  overrideCheck: OverrideCheck | null,
  loading: boolean,
): BrowserPresentation {
  if (overrideCheck?.state === "validating") {
    return {
      kind: "loading",
      label: "Checking custom path",
      path: overrideCheck.path,
      detail: "Validating the selected executable.",
      error: null,
    };
  }
  if (overrideCheck?.state === "valid") {
    return {
      kind: "available",
      label: "Custom executable",
      path: overrideCheck.path,
      detail: "Validated custom executable.",
      error: null,
    };
  }
  if (overrideCheck?.state === "invalid") {
    return {
      kind: "error",
      label: "Custom path unavailable",
      path: overrideCheck.path,
      detail: "The selected executable was moved or is no longer valid.",
      error: `The selected executable was moved or is no longer valid. ${overrideCheck.error}`,
    };
  }
  if (detection?.available && detection.resolvedPath) {
    return {
      kind: "available",
      label: "Detected",
      path: detection.resolvedPath,
      detail: "Installed browser detected.",
      error: null,
    };
  }
  if (loading) {
    return {
      kind: "loading",
      label: "Checking",
      path: null,
      detail: "Looking for an installed browser.",
      error: null,
    };
  }
  return {
    kind: "unavailable",
    label: "Not detected",
    path: null,
    detail: "Choose the browser executable to configure it manually.",
    error: null,
  };
}

function normalizeDetections(values: BrowserDetection[]): BrowserDetection[] {
  return BROWSERS.map((browser) => {
    const match = values.find((value) => value.id === browser.id);
    if (!match?.available || !match.resolvedPath) {
      return { ...browser, available: false, resolvedPath: null };
    }
    return {
      id: browser.id,
      name: browser.name,
      available: true,
      resolvedPath: match.resolvedPath,
    };
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "An unknown browser configuration error occurred.";
}
