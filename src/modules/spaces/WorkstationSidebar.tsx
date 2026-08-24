import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Archive02Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  FolderOpenIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef, useState } from "react";

export type WorkstationSidebarItem = {
  id: string;
  name: string;
  root: string;
  color?: string;
  unavailable?: boolean;
  unavailableReason?: string;
  archiveDisabled?: boolean;
  archiveDisabledReason?: string;
};

export type WorkstationSidebarProps = {
  workstations: readonly WorkstationSidebarItem[];
  activeId: string | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onOpenWorkstation: (id: string) => void;
  onCreateWorkstation: () => void;
  onOpenExistingWorkstation: () => void;
  onRenameWorkstation: (id: string, name: string) => void;
  onReorderWorkstations: (orderedIds: string[]) => void;
  onArchiveWorkstation: (id: string) => void;
  className?: string;
};

export type WorkstationMoveDirection = "up" | "down";

export function moveWorkstationIds(
  workstations: readonly Pick<WorkstationSidebarItem, "id">[],
  id: string,
  direction: WorkstationMoveDirection,
): string[] | null {
  const ids = workstations.map((workstation) => workstation.id);
  const index = ids.indexOf(id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ids.length) return null;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return ids;
}

export function normalizeWorkstationName(value: string): string | null {
  const name = value.trim();
  return name.length > 0 ? name : null;
}

export function workstationRootLabel(root: string): string {
  const value = root.trim();
  if (!value) return "Root unavailable";
  if (/^[A-Za-z]:[\\/]?$/.test(value)) return value.replace("/", "\\");
  if (/^[\\/]$/.test(value)) return value;
  const withoutTrailingSeparators = value.replace(/[\\/]+$/, "");
  const segments = withoutTrailingSeparators.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? value;
}

export function WorkstationSidebar({
  workstations,
  activeId,
  loading = false,
  error,
  onRetry,
  onOpenWorkstation,
  onCreateWorkstation,
  onOpenExistingWorkstation,
  onRenameWorkstation,
  onReorderWorkstations,
  onArchiveWorkstation,
  className,
}: WorkstationSidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);
  const pendingArchive =
    workstations.find((workstation) => workstation.id === pendingArchiveId) ??
    null;

  const move = (id: string, direction: WorkstationMoveDirection) => {
    const orderedIds = moveWorkstationIds(workstations, id, direction);
    if (orderedIds) onReorderWorkstations(orderedIds);
  };

  return (
    <TooltipProvider delayDuration={450} skipDelayDuration={150}>
      <aside
        aria-label="Workstations"
        className={cn(
          "flex h-full min-h-0 w-52 shrink-0 flex-col border-r border-border/60 bg-background",
          className,
        )}
      >
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2">
          <h2 className="min-w-0 flex-1 truncate px-1 text-[11px] font-semibold uppercase text-muted-foreground">
            Workstations
          </h2>
          <SidebarIconButton
            label="Open folder as workstation"
            icon={FolderOpenIcon}
            onClick={onOpenExistingWorkstation}
          />
          <SidebarIconButton
            label="Create workstation"
            icon={PlusSignIcon}
            onClick={onCreateWorkstation}
          />
        </div>

        {error ? (
          <div
            role="alert"
            className="mx-2 mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2"
          >
            <p className="text-[11px] font-medium text-destructive">
              Workstations unavailable
            </p>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              {error}
            </p>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="mt-2 flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-foreground outline-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-destructive/30"
              >
                <HugeiconsIcon icon={RefreshIcon} size={12} strokeWidth={2} />
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          {loading && workstations.length === 0 ? (
            <WorkstationLoadingState />
          ) : workstations.length === 0 ? (
            <WorkstationEmptyState
              onCreate={onCreateWorkstation}
              onOpenExisting={onOpenExistingWorkstation}
            />
          ) : (
            <ol
              aria-label="Saved workstations"
              className="flex flex-col gap-0.5"
            >
              {workstations.map((workstation, index) => (
                <WorkstationRow
                  key={workstation.id}
                  workstation={workstation}
                  active={workstation.id === activeId}
                  first={index === 0}
                  last={index === workstations.length - 1}
                  renaming={renamingId === workstation.id}
                  onOpen={() => onOpenWorkstation(workstation.id)}
                  onStartRename={() => setRenamingId(workstation.id)}
                  onCommitRename={(name) => {
                    setRenamingId(null);
                    onRenameWorkstation(workstation.id, name);
                  }}
                  onCancelRename={() => setRenamingId(null)}
                  onMoveUp={() => move(workstation.id, "up")}
                  onMoveDown={() => move(workstation.id, "down")}
                  onArchive={() => setPendingArchiveId(workstation.id)}
                />
              ))}
            </ol>
          )}
        </div>

        {loading && workstations.length > 0 ? (
          <div
            role="status"
            className="shrink-0 border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground"
          >
            Updating workstations...
          </div>
        ) : null}
      </aside>

      <AlertDialog
        open={pendingArchive !== null}
        onOpenChange={(open) => {
          if (!open) setPendingArchiveId(null);
        }}
      >
        <AlertDialogContent size="sm" className="rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive workstation?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingArchive ? (
                <>
                  <span className="font-medium text-foreground">
                    {pendingArchive.name}
                  </span>{" "}
                  will be removed from Afflow's workstation list. Its folder and
                  files remain on disk.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!pendingArchive) return;
                onArchiveWorkstation(pendingArchive.id);
                setPendingArchiveId(null);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}

function WorkstationRow({
  workstation,
  active,
  first,
  last,
  renaming,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onMoveUp,
  onMoveDown,
  onArchive,
}: {
  workstation: WorkstationSidebarItem;
  active: boolean;
  first: boolean;
  last: boolean;
  renaming: boolean;
  onOpen: () => void;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onArchive: () => void;
}) {
  const archiveTitle = workstation.archiveDisabled
    ? (workstation.archiveDisabledReason ??
      "This workstation cannot be archived")
    : "Archive workstation";

  return (
    <li
      className={cn(
        "group relative flex min-h-11 items-center rounded-md outline-none transition-colors focus-within:bg-accent/60 hover:bg-accent/50",
        active && "bg-accent",
      )}
    >
      {renaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
          <WorkstationMark workstation={workstation} active={active} />
          <InlineWorkstationRename
            initial={workstation.name}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
          />
        </div>
      ) : (
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          aria-label={`Open ${workstation.name}`}
          aria-describedby={
            workstation.unavailable
              ? `workstation-${workstation.id}-status`
              : undefined
          }
          disabled={workstation.unavailable}
          title={workstation.unavailableReason ?? workstation.root}
          onClick={onOpen}
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
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-55"
        >
          <WorkstationMark workstation={workstation} active={active} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[11.5px] font-medium leading-4 text-foreground">
              {workstation.name}
            </span>
            <span
              id={`workstation-${workstation.id}-status`}
              className={cn(
                "truncate text-[9.5px] leading-3.5 text-muted-foreground/70",
                workstation.unavailable && "text-destructive/80",
              )}
            >
              {workstation.unavailable
                ? (workstation.unavailableReason ?? "Folder unavailable")
                : workstationRootLabel(workstation.root)}
            </span>
          </span>
        </button>
      )}

      {!renaming ? (
        <div className="absolute right-1 flex items-center rounded bg-accent/95 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <RowIconButton
            label="Move workstation up"
            icon={ArrowUp01Icon}
            disabled={first}
            onClick={onMoveUp}
          />
          <RowIconButton
            label="Move workstation down"
            icon={ArrowDown01Icon}
            disabled={last}
            onClick={onMoveDown}
          />
          <RowIconButton
            label="Rename workstation"
            icon={PencilEdit02Icon}
            onClick={onStartRename}
          />
          <RowIconButton
            label={archiveTitle}
            icon={Archive02Icon}
            disabled={workstation.archiveDisabled}
            destructive
            onClick={onArchive}
          />
        </div>
      ) : null}
    </li>
  );
}

function WorkstationMark({
  workstation,
  active,
}: {
  workstation: WorkstationSidebarItem;
  active: boolean;
}) {
  const color = workstation.color ?? "var(--muted-foreground)";
  const initial = Array.from(workstation.name.trim())[0]?.toUpperCase() ?? "W";
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold leading-none ring-1 ring-inset"
      style={{
        color,
        backgroundColor: active
          ? `color-mix(in oklch, ${color} 16%, transparent)`
          : "transparent",
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${color} ${active ? 35 : 18}%, transparent)`,
      }}
    >
      {initial}
    </span>
  );
}

function InlineWorkstationRename({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const done = useRef(false);

  const finish = (value: string) => {
    if (done.current) return;
    done.current = true;
    const name = normalizeWorkstationName(value);
    if (name) onCommit(name);
    else onCancel();
  };

  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: rename is an explicit user action
      autoFocus
      defaultValue={initial}
      aria-label="Rename workstation"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(event.currentTarget.value);
        else if (event.key === "Escape") {
          done.current = true;
          onCancel();
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
      className="h-7 min-w-0 flex-1 rounded-md bg-background px-2 text-[11.5px] text-foreground outline-none ring-1 ring-border focus:ring-primary/50"
    />
  );
}

function SidebarIconButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: typeof PlusSignIcon;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <HugeiconsIcon icon={icon} size={14} strokeWidth={1.8} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={5}>
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
  icon: typeof PlusSignIcon;
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
            "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-background/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-30",
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

function WorkstationLoadingState() {
  return (
    <div
      role="status"
      className="space-y-1 px-0.5 py-1"
      aria-label="Loading workstations"
    >
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="flex h-11 items-center gap-2 rounded-md px-2"
        >
          <span className="size-6 animate-pulse rounded-md bg-muted" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="h-2.5 w-2/3 animate-pulse rounded-sm bg-muted" />
            <span className="h-2 w-1/2 animate-pulse rounded-sm bg-muted/70" />
          </span>
        </div>
      ))}
    </div>
  );
}

function WorkstationEmptyState({
  onCreate,
  onOpenExisting,
}: {
  onCreate: () => void;
  onOpenExisting: () => void;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-3 py-6 text-center">
      <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <HugeiconsIcon icon={FolderOpenIcon} size={16} strokeWidth={1.75} />
      </span>
      <p className="mt-3 text-xs font-medium text-foreground">
        No workstations
      </p>
      <div className="mt-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCreate}
          className="h-7 rounded-md bg-primary px-2.5 text-[10.5px] font-medium text-primary-foreground outline-none hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Create
        </button>
        <button
          type="button"
          onClick={onOpenExisting}
          className="h-7 rounded-md border border-border px-2.5 text-[10.5px] font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Open folder
        </button>
      </div>
    </div>
  );
}
