import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { BrowserProfileResetDialog } from "@/modules/browser-tools/components/BrowserProfileResetDialog";
import {
  BrowserToolDialog,
  type BrowserToolDraft,
} from "@/modules/browser-tools/components/BrowserToolDialog";
import type {
  BrowserId,
  BrowserProfileMode,
  BrowserTool,
} from "@/modules/browser-tools/lib/types";
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  BrowserIcon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  FolderOpenIcon,
  LinkSquare02Icon,
  PencilEdit02Icon,
  PlayIcon,
  PlusSignIcon,
  RefreshIcon,
  Settings02Icon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

export type BrowserToolLauncherBrowserId = BrowserId;
export type BrowserToolLauncherProfileMode = BrowserProfileMode;
export type BrowserToolLauncherActivity =
  | "loading"
  | "idle"
  | "active"
  | "unknown"
  | "error";
export type BrowserToolLauncherPendingAction =
  | "launch-all"
  | `launch-tool:${string}`
  | "open-profile-folder"
  | "reset-profile"
  | "save-tool";

export type BrowserToolLauncherItem = BrowserTool;

export type BrowserToolLauncherBrowser = {
  id: BrowserToolLauncherBrowserId;
  name: string;
  status: "loading" | "available" | "unavailable" | "moved" | "error";
  resolvedPath?: string | null;
  message?: string;
};

export type BrowserToolLauncherProfile = {
  activity: BrowserToolLauncherActivity;
  exists?: boolean;
  profilePath?: string;
  message?: string;
};

export type BrowserToolLauncherProps = {
  contextKey: string;
  tools: readonly BrowserToolLauncherItem[];
  profileMode: BrowserToolLauncherProfileMode;
  browser: BrowserToolLauncherBrowser;
  profile: BrowserToolLauncherProfile;
  loading?: boolean;
  error?: string | null;
  notice?: string | null;
  pendingAction?: BrowserToolLauncherPendingAction | null;
  maxTools?: number;
  openOnWorkstationLaunch?: boolean;
  onRetry?: () => void;
  onOpenBrowserSettings?: () => void;
  onLaunchAll: () => void;
  onLaunchTool: (tool: BrowserToolLauncherItem) => void;
  onProfileModeChange: (mode: BrowserToolLauncherProfileMode) => void;
  onAddTool: (draft: BrowserToolDraft) => void;
  onUpdateTool: (id: string, draft: BrowserToolDraft) => void;
  onRemoveTool: (id: string) => void;
  onReorderTools: (orderedIds: string[]) => void;
  onOpenOnWorkstationLaunchChange?: (enabled: boolean) => void;
  onOpenProfileFolder: () => void;
  onResetProfile: () => void;
  onMenuOpenChange?: (open: boolean) => void;
  className?: string;
};

export type BrowserToolMoveDirection = "up" | "down";

export function isCurrentBrowserLauncherContext(
  openedContextKey: string | null,
  currentContextKey: string,
): boolean {
  return openedContextKey !== null && openedContextKey === currentContextKey;
}

export function moveBrowserToolIds(
  tools: readonly Pick<BrowserToolLauncherItem, "id">[],
  id: string,
  direction: BrowserToolMoveDirection,
): string[] | null {
  const ids = tools.map((tool) => tool.id);
  const index = ids.indexOf(id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ids.length) return null;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return ids;
}

export function displayBrowserToolUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return `${url.hostname}${path}`;
  } catch {
    return "Invalid URL";
  }
}

export function BrowserToolLauncher({
  contextKey,
  tools,
  profileMode,
  browser,
  profile,
  loading = false,
  error,
  notice,
  pendingAction,
  maxTools = 16,
  openOnWorkstationLaunch = false,
  onRetry,
  onOpenBrowserSettings,
  onLaunchAll,
  onLaunchTool,
  onProfileModeChange,
  onAddTool,
  onUpdateTool,
  onRemoveTool,
  onReorderTools,
  onOpenOnWorkstationLaunchChange,
  onOpenProfileFolder,
  onResetProfile,
  className,
}: BrowserToolLauncherProps) {
  const [toolDialog, setToolDialog] = useState<
    | { kind: "add"; contextKey: string }
    | {
        kind: "edit";
        contextKey: string;
        tool: BrowserToolLauncherItem;
      }
    | null
  >(null);
  const [resetContextKey, setResetContextKey] = useState<string | null>(null);
  const operationPending = pendingAction != null;
  const browserReady = browser.status === "available";
  const profileReady =
    profile.activity !== "loading" && profile.activity !== "error";
  const canLaunch =
    browserReady && profileReady && !loading && !operationPending;
  const canReset =
    profile.activity === "idle" &&
    profile.exists === true &&
    !loading &&
    !operationPending;
  const atToolLimit = tools.length >= maxTools;

  const move = (id: string, direction: BrowserToolMoveDirection) => {
    const orderedIds = moveBrowserToolIds(tools, id, direction);
    if (orderedIds) onReorderTools(orderedIds);
  };

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={120}>
      <section
        aria-label="Browser tools"
        aria-busy={loading || operationPending}
        className={cn(
          "flex min-h-0 flex-col bg-background text-foreground",
          className,
        )}
      >
        <header className="flex min-h-12 items-center gap-2 border-b border-border/60 px-3 py-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <HugeiconsIcon icon={BrowserIcon} size={15} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xs font-semibold">Browser tools</h2>
            <BrowserStatus browser={browser} />
          </div>
          <Button
            type="button"
            size="sm"
            className="rounded-md"
            disabled={!canLaunch || tools.length === 0}
            onClick={onLaunchAll}
          >
            {pendingAction === "launch-all" ? (
              <Spinner className="size-3" />
            ) : (
              <HugeiconsIcon icon={PlayIcon} size={13} strokeWidth={2} />
            )}
            Open all
          </Button>
        </header>

        <div className="border-b border-border/60 px-3 py-3">
          <fieldset>
            <legend className="mb-1.5 text-[10px] font-medium uppercase text-muted-foreground">
              Profile
            </legend>
            <div className="grid grid-cols-2 rounded-md bg-muted/55 p-0.5">
              <ProfileModeButton
                mode="workstation"
                selected={profileMode === "workstation"}
                disabled={loading || operationPending}
                icon={UserIcon}
                label="This workstation"
                onSelect={onProfileModeChange}
              />
              <ProfileModeButton
                mode="shared"
                selected={profileMode === "shared"}
                disabled={loading || operationPending}
                icon={UserGroupIcon}
                label="Shared"
                onSelect={onProfileModeChange}
              />
            </div>
          </fieldset>

          {onOpenOnWorkstationLaunchChange ? (
            <label
              htmlFor="browser-tools-auto-open"
              className={cn(
                "mt-2 flex min-h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-[10.5px] text-muted-foreground outline-none hover:text-foreground",
                (loading || operationPending) &&
                  "cursor-not-allowed opacity-50",
              )}
            >
              <Checkbox
                id="browser-tools-auto-open"
                checked={openOnWorkstationLaunch}
                disabled={loading || operationPending}
                onCheckedChange={(checked) =>
                  onOpenOnWorkstationLaunchChange(checked === true)
                }
              />
              <span>Open tools when workstation activates</span>
            </label>
          ) : null}

          <div className="mt-2 flex min-h-7 items-center gap-2">
            <ProfileStatus profile={profile} />
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <IconButton
                label="Open managed profile folder"
                icon={FolderOpenIcon}
                disabled={
                  loading ||
                  operationPending ||
                  profile.activity === "loading" ||
                  profile.activity === "error"
                }
                loading={pendingAction === "open-profile-folder"}
                onClick={onOpenProfileFolder}
              />
              <IconButton
                label={resetButtonLabel(profile)}
                icon={RefreshIcon}
                destructive
                disabled={!canReset}
                loading={pendingAction === "reset-profile"}
                onClick={() => setResetContextKey(contextKey)}
              />
            </div>
          </div>
        </div>

        {browser.status !== "available" ? (
          <BrowserIssue
            browser={browser}
            onRetry={onRetry}
            onOpenBrowserSettings={onOpenBrowserSettings}
          />
        ) : null}
        {error ? <FeedbackMessage kind="error" message={error} /> : null}
        {notice ? <FeedbackMessage kind="success" message={notice} /> : null}

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center border-b border-border/60 px-3">
            <h3 className="text-[11px] font-semibold uppercase text-muted-foreground">
              Saved websites
            </h3>
            <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground/70">
              {tools.length}/{maxTools}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="ml-auto rounded-md"
              disabled={loading || operationPending || atToolLimit}
              title={
                atToolLimit ? `Maximum of ${maxTools} tools reached` : undefined
              }
              onClick={() => setToolDialog({ kind: "add", contextKey })}
            >
              <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={2} />
              Add
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
            {loading && tools.length === 0 ? (
              <BrowserToolsLoadingState />
            ) : tools.length === 0 ? (
              <BrowserToolsEmptyState
                disabled={operationPending || atToolLimit}
                onAdd={() => setToolDialog({ kind: "add", contextKey })}
              />
            ) : (
              <ol aria-label="Saved website tools" className="space-y-0.5">
                {tools.map((tool, index) => (
                  <BrowserToolRow
                    key={tool.id}
                    tool={tool}
                    first={index === 0}
                    last={index === tools.length - 1}
                    launchDisabled={!canLaunch}
                    launchPending={pendingAction === `launch-tool:${tool.id}`}
                    mutationDisabled={loading || operationPending}
                    onLaunch={() => onLaunchTool(tool)}
                    onMoveUp={() => move(tool.id, "up")}
                    onMoveDown={() => move(tool.id, "down")}
                    onEdit={() =>
                      setToolDialog({ kind: "edit", contextKey, tool })
                    }
                    onRemove={() => onRemoveTool(tool.id)}
                  />
                ))}
              </ol>
            )}
          </div>
        </div>
      </section>

      {toolDialog &&
      isCurrentBrowserLauncherContext(toolDialog.contextKey, contextKey) ? (
        <BrowserToolDialog
          key={toolDialog.kind === "edit" ? toolDialog.tool.id : "new-tool"}
          open
          tool={
            toolDialog.kind === "edit"
              ? { name: toolDialog.tool.name, url: toolDialog.tool.url }
              : undefined
          }
          onOpenChange={(open) => {
            if (!open) setToolDialog(null);
          }}
          onSubmit={(draft) => {
            if (
              !isCurrentBrowserLauncherContext(
                toolDialog.contextKey,
                contextKey,
              )
            )
              return;
            if (toolDialog.kind === "edit")
              onUpdateTool(toolDialog.tool.id, draft);
            else onAddTool(draft);
          }}
        />
      ) : null}

      <BrowserProfileResetDialog
        open={isCurrentBrowserLauncherContext(resetContextKey, contextKey)}
        browserName={browser.name}
        profileLabel={profileMode === "shared" ? "shared" : "workstation"}
        onOpenChange={(open) => {
          if (!open) setResetContextKey(null);
        }}
        onConfirm={() => {
          if (isCurrentBrowserLauncherContext(resetContextKey, contextKey))
            onResetProfile();
        }}
      />
    </TooltipProvider>
  );
}

function BrowserStatus({ browser }: { browser: BrowserToolLauncherBrowser }) {
  const text =
    browser.status === "loading"
      ? `Detecting ${browser.name}...`
      : browser.status === "available"
        ? `${browser.name} ready`
        : browser.status === "moved"
          ? `${browser.name} executable moved`
          : browser.status === "unavailable"
            ? `${browser.name} not found`
            : `${browser.name} detection failed`;
  return (
    <p
      role={browser.status === "loading" ? "status" : undefined}
      title={browser.resolvedPath ?? browser.message}
      className={cn(
        "truncate text-[10px] leading-4 text-muted-foreground",
        browser.status !== "available" &&
          browser.status !== "loading" &&
          "text-destructive",
      )}
    >
      {text}
    </p>
  );
}

function BrowserIssue({
  browser,
  onRetry,
  onOpenBrowserSettings,
}: {
  browser: BrowserToolLauncherBrowser;
  onRetry?: () => void;
  onOpenBrowserSettings?: () => void;
}) {
  if (browser.status === "loading") {
    return (
      <div
        role="status"
        className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground"
      >
        <Spinner className="size-3" /> Detecting installed browser...
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="border-b border-destructive/20 bg-destructive/5 px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <HugeiconsIcon
          icon={Alert02Icon}
          size={14}
          strokeWidth={1.8}
          className="mt-0.5 shrink-0 text-destructive"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-destructive">
            {browser.status === "moved"
              ? "Browser executable moved"
              : browser.status === "unavailable"
                ? "Browser unavailable"
                : "Browser detection failed"}
          </p>
          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
            {browser.message ??
              "Choose an installed Chrome or Edge executable in Browser settings."}
          </p>
          <div className="mt-1.5 flex gap-1">
            {onOpenBrowserSettings ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="rounded-md"
                onClick={onOpenBrowserSettings}
              >
                <HugeiconsIcon
                  icon={Settings02Icon}
                  size={11}
                  strokeWidth={2}
                />{" "}
                Settings
              </Button>
            ) : null}
            {onRetry ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="rounded-md"
                onClick={onRetry}
              >
                <HugeiconsIcon icon={RefreshIcon} size={11} strokeWidth={2} />{" "}
                Retry
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileStatus({ profile }: { profile: BrowserToolLauncherProfile }) {
  if (profile.activity === "loading") {
    return (
      <span
        role="status"
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
      >
        <Spinner className="size-3" /> Checking profile...
      </span>
    );
  }
  const status =
    profile.activity === "active"
      ? "Profile in use"
      : profile.activity === "unknown"
        ? "Profile activity unknown"
        : profile.activity === "error"
          ? (profile.message ?? "Profile unavailable")
          : profile.exists
            ? "Managed profile ready"
            : "Created on first launch";
  return (
    <span
      role={profile.activity === "error" ? "alert" : "status"}
      title={profile.profilePath ?? profile.message}
      className={cn(
        "flex min-w-0 items-center gap-1.5 truncate text-[10px] text-muted-foreground",
        (profile.activity === "active" || profile.activity === "unknown") &&
          "text-amber-600 dark:text-amber-400",
        profile.activity === "error" && "text-destructive",
      )}
    >
      {profile.activity === "idle" ? (
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          size={12}
          strokeWidth={2}
          className="shrink-0"
        />
      ) : (
        <HugeiconsIcon
          icon={Alert02Icon}
          size={12}
          strokeWidth={2}
          className="shrink-0"
        />
      )}
      <span className="truncate">{status}</span>
    </span>
  );
}

function FeedbackMessage({
  kind,
  message,
}: {
  kind: "error" | "success";
  message: string;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 border-b px-3 py-2 text-[10px] leading-4",
        kind === "error"
          ? "border-destructive/20 bg-destructive/5 text-destructive"
          : "border-border/60 bg-primary/5 text-foreground",
      )}
    >
      <HugeiconsIcon
        icon={kind === "error" ? Alert02Icon : CheckmarkCircle02Icon}
        size={13}
        strokeWidth={2}
        className="mt-0.5 shrink-0"
      />
      <span>{message}</span>
    </div>
  );
}

function ProfileModeButton({
  mode,
  selected,
  disabled,
  icon,
  label,
  onSelect,
}: {
  mode: BrowserToolLauncherProfileMode;
  selected: boolean;
  disabled: boolean;
  icon: typeof UserIcon;
  label: string;
  onSelect: (mode: BrowserToolLauncherProfileMode) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onSelect(mode)}
      className={cn(
        "flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-[5px] px-2 text-[10.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50",
        selected
          ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <HugeiconsIcon
        icon={icon}
        size={12}
        strokeWidth={1.8}
        className="shrink-0"
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

function BrowserToolRow({
  tool,
  first,
  last,
  launchDisabled,
  launchPending,
  mutationDisabled,
  onLaunch,
  onMoveUp,
  onMoveDown,
  onEdit,
  onRemove,
}: {
  tool: BrowserToolLauncherItem;
  first: boolean;
  last: boolean;
  launchDisabled: boolean;
  launchPending: boolean;
  mutationDisabled: boolean;
  onLaunch: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="group relative flex min-h-11 items-center rounded-md transition-colors focus-within:bg-accent/60 hover:bg-accent/50">
      <button
        type="button"
        disabled={launchDisabled}
        aria-label={`Launch ${tool.name}`}
        onClick={onLaunch}
        onKeyDown={(event) => {
          if (!event.altKey) return;
          if (event.key === "ArrowUp" && !first) {
            event.preventDefault();
            onMoveUp();
          } else if (event.key === "ArrowDown" && !last) {
            event.preventDefault();
            onMoveDown();
          }
        }}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 pr-28 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {launchPending ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon
              icon={LinkSquare02Icon}
              size={13}
              strokeWidth={1.8}
            />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[11.5px] font-medium leading-4">
            {tool.name}
          </span>
          <span className="truncate text-[9.5px] leading-3.5 text-muted-foreground/80">
            {displayBrowserToolUrl(tool.url)}
          </span>
        </span>
      </button>
      <div className="absolute right-1 flex items-center rounded bg-accent/95 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <RowIconButton
          label="Move tool up"
          icon={ArrowUp01Icon}
          disabled={mutationDisabled || first}
          onClick={onMoveUp}
        />
        <RowIconButton
          label="Move tool down"
          icon={ArrowDown01Icon}
          disabled={mutationDisabled || last}
          onClick={onMoveDown}
        />
        <RowIconButton
          label={`Edit ${tool.name}`}
          icon={PencilEdit02Icon}
          disabled={mutationDisabled}
          onClick={onEdit}
        />
        <RowIconButton
          label={`Remove ${tool.name}`}
          icon={Delete02Icon}
          disabled={mutationDisabled}
          destructive
          onClick={onRemove}
        />
      </div>
    </li>
  );
}

function IconButton({
  label,
  icon,
  disabled,
  destructive,
  loading,
  onClick,
}: {
  label: string;
  icon: typeof FolderOpenIcon;
  disabled?: boolean;
  destructive?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-35",
            destructive && "hover:text-destructive",
          )}
        >
          {loading ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={icon} size={13} strokeWidth={1.8} />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function RowIconButton({
  label,
  icon,
  disabled,
  destructive,
  onClick,
}: {
  label: string;
  icon: typeof ArrowUp01Icon;
  disabled?: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-background/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-25",
            destructive && "hover:text-destructive",
          )}
        >
          <HugeiconsIcon icon={icon} size={11} strokeWidth={2} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function BrowserToolsLoadingState() {
  return (
    <div
      role="status"
      aria-label="Loading browser tools"
      className="space-y-1 py-1"
    >
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="flex h-11 items-center gap-2 rounded-md px-2"
        >
          <span className="size-6 animate-pulse rounded-md bg-muted" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="h-2.5 w-2/5 animate-pulse rounded-sm bg-muted" />
            <span className="h-2 w-3/5 animate-pulse rounded-sm bg-muted/70" />
          </span>
        </div>
      ))}
    </div>
  );
}

function BrowserToolsEmptyState({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center px-4 py-6 text-center">
      <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <HugeiconsIcon icon={LinkSquare02Icon} size={15} strokeWidth={1.8} />
      </span>
      <p className="mt-2.5 text-xs font-medium">No saved websites</p>
      <p className="mt-1 max-w-56 text-[10px] leading-4 text-muted-foreground">
        Add the sites you use in this workstation.
      </p>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="mt-3 rounded-md"
        disabled={disabled}
        onClick={onAdd}
      >
        <HugeiconsIcon icon={PlusSignIcon} size={11} strokeWidth={2} /> Add
        website
      </Button>
    </div>
  );
}

function resetButtonLabel(profile: BrowserToolLauncherProfile): string {
  const { activity } = profile;
  if (activity === "active")
    return "Close the managed browser before resetting";
  if (activity === "unknown") return "Cannot verify the profile is closed";
  if (activity === "loading")
    return "Checking whether the profile can be reset";
  if (activity === "error") return "Profile reset unavailable";
  if (!profile.exists) return "Profile has not been created yet";
  return "Reset managed profile";
}
