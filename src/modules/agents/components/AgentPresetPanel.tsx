import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import {
  AFFLOW_PRESET_LAUNCHER_IDS,
  type AfflowAgentPresetId,
  type AfflowPresetLauncherId,
  isAfflowAgentPresetId,
  isAfflowPresetLauncherId,
  validatePresetCustomCommand,
  type WorkstationAgentPreset,
} from "@/modules/agents/lib/presets";
import {
  Add01Icon,
  ArrowLeft01Icon,
  Copy01Icon,
  File02Icon,
  FolderOpenIcon,
  LayoutTwoColumnIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

const LAUNCHER_LABELS: Record<AfflowPresetLauncherId, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
  custom: "Custom",
};

export type AgentPresetAvailability = {
  available: boolean;
  reason?: string;
};

export type AgentPresetUpdate = Pick<
  WorkstationAgentPreset,
  "launcherId" | "customCommand"
>;

export type AgentPresetPanelProps = {
  presets: readonly WorkstationAgentPreset[];
  selectedPresetId: AfflowAgentPresetId | null;
  cliAvailability?: Partial<
    Record<AfflowPresetLauncherId, AgentPresetAvailability>
  >;
  promptAvailability?: Partial<
    Record<AfflowAgentPresetId, AgentPresetAvailability>
  >;
  workstationRoot?: string | null;
  loading?: boolean;
  error?: string | null;
  onSelect: (presetId: AfflowAgentPresetId) => void;
  onUpdatePreset: (
    presetId: AfflowAgentPresetId,
    update: AgentPresetUpdate,
  ) => void;
  onRequestCreatePreset: () => void;
  onLaunch: (presetId: AfflowAgentPresetId) => void;
  onLaunchInPane: (presetId: AfflowAgentPresetId) => void;
  focusedPane: {
    available: boolean;
    reason?: string;
  };
  onOpenPrompt: (presetId: AfflowAgentPresetId) => void;
  onCopyStartupInstruction: (presetId: AfflowAgentPresetId) => void;
  onOpenOutputs: (presetId: AfflowAgentPresetId) => void;
  onBack?: () => void;
};

export function AgentPresetPanel({
  presets,
  selectedPresetId,
  cliAvailability,
  promptAvailability,
  workstationRoot,
  loading = false,
  error,
  onSelect,
  onUpdatePreset,
  onRequestCreatePreset,
  onLaunch,
  onLaunchInPane,
  focusedPane,
  onOpenPrompt,
  onCopyStartupInstruction,
  onOpenOutputs,
  onBack,
}: AgentPresetPanelProps) {
  const validPresets = Array.isArray(presets)
    ? presets.filter(isRenderablePreset)
    : [];
  const selectedPreset = validPresets.find(
    (preset) => preset.id === selectedPresetId,
  );

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={150}>
      <section
        className="min-w-0 animate-in fade-in-0 slide-in-from-right-2 duration-150"
        aria-busy={loading}
        aria-label="Agent presets"
      >
        <div className="flex h-9 min-w-0 items-center gap-2 px-1">
          {onBack ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="rounded-md text-muted-foreground"
                  onClick={onBack}
                  aria-label="Back to new tab menu"
                >
                  <HugeiconsIcon
                    icon={ArrowLeft01Icon}
                    size={14}
                    strokeWidth={1.75}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Back</TooltipContent>
            </Tooltip>
          ) : null}
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-medium text-foreground">
              Agent presets
            </h2>
            <p className="truncate text-[10px] text-muted-foreground">
              Choose a workflow role and CLI
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto rounded-md text-muted-foreground"
            disabled={loading || !workstationRoot}
            onClick={onRequestCreatePreset}
          >
            <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={1.8} />
            New preset
          </Button>
          {loading ? (
            <span
              className="text-[10px] text-muted-foreground"
              aria-live="polite"
            >
              Loading
            </span>
          ) : null}
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive"
          >
            {error}
          </div>
        ) : null}

        {validPresets.length === 0 ? (
          <div className="mt-1.5 rounded-md border border-border/60 px-3 py-4 text-center">
            <p className="text-xs font-medium text-foreground">
              No agent presets
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Workstation presets could not be loaded.
            </p>
          </div>
        ) : (
          <fieldset className="mt-1.5 border-t border-border/60 pt-1.5">
            <legend className="sr-only">Workflow role</legend>
            <div className="grid gap-0.5">
              {validPresets.map((preset) => {
                const selected = preset.id === selectedPreset?.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={loading}
                    onClick={() => onSelect(preset.id)}
                    className={cn(
                      "flex min-h-8 min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50",
                      selected
                        ? "border-primary/35 bg-primary/10 text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        selected ? "bg-primary" : "bg-muted-foreground/40",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {preset.name}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {LAUNCHER_LABELS[preset.launcherId]}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {selectedPreset ? (
          <PresetControls
            preset={selectedPreset}
            cliAvailability={cliAvailability}
            promptAvailability={promptAvailability?.[selectedPreset.id]}
            workstationRoot={workstationRoot}
            loading={loading}
            error={error}
            onUpdatePreset={onUpdatePreset}
            onLaunch={onLaunch}
            onLaunchInPane={onLaunchInPane}
            focusedPane={focusedPane}
            onOpenPrompt={onOpenPrompt}
            onCopyStartupInstruction={onCopyStartupInstruction}
            onOpenOutputs={onOpenOutputs}
          />
        ) : validPresets.length > 0 ? (
          <p
            className="mt-2 rounded-md border border-border/60 px-3 py-3 text-center text-[11px] text-muted-foreground"
            role="status"
          >
            Choose a workflow role to configure it.
          </p>
        ) : null}
      </section>
    </TooltipProvider>
  );
}

type PresetControlsProps = {
  preset: WorkstationAgentPreset;
  cliAvailability?: AgentPresetPanelProps["cliAvailability"];
  promptAvailability?: AgentPresetAvailability;
  workstationRoot?: string | null;
  loading: boolean;
  error?: string | null;
  onUpdatePreset: AgentPresetPanelProps["onUpdatePreset"];
  onLaunch: AgentPresetPanelProps["onLaunch"];
  onLaunchInPane: AgentPresetPanelProps["onLaunchInPane"];
  focusedPane: AgentPresetPanelProps["focusedPane"];
  onOpenPrompt: AgentPresetPanelProps["onOpenPrompt"];
  onCopyStartupInstruction: AgentPresetPanelProps["onCopyStartupInstruction"];
  onOpenOutputs: AgentPresetPanelProps["onOpenOutputs"];
};

function PresetControls({
  preset,
  cliAvailability,
  promptAvailability,
  workstationRoot,
  loading,
  error,
  onUpdatePreset,
  onLaunch,
  onLaunchInPane,
  focusedPane,
  onOpenPrompt,
  onCopyStartupInstruction,
  onOpenOutputs,
}: PresetControlsProps) {
  const customValidation = validatePresetCustomCommand(preset.customCommand);
  const selectedCliStatus =
    preset.launcherId === "custom"
      ? { available: customValidation.ok }
      : cliAvailability?.[preset.launcherId];
  const rootAvailable = Boolean(workstationRoot?.trim());
  const promptRequired = preset.promptFile !== null;
  const promptAvailable = promptAvailability?.available !== false;
  const blockingMessage = launchBlockingMessage({
    preset,
    cliAvailability,
    promptAvailability,
    rootAvailable,
  });
  const disabled = loading || Boolean(error) || Boolean(blockingMessage);

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <fieldset disabled={loading}>
        <legend className="mb-1.5 text-[11px] font-medium text-muted-foreground">
          Command line tool
        </legend>
        <div className="grid grid-cols-2 gap-1">
          {AFFLOW_PRESET_LAUNCHER_IDS.map((launcherId) => {
            const selected = preset.launcherId === launcherId;
            const available =
              launcherId === "custom" ||
              cliAvailability?.[launcherId]?.available === true;
            return (
              <button
                key={launcherId}
                type="button"
                aria-pressed={selected}
                aria-describedby={
                  !available ? `agent-cli-${launcherId}-status` : undefined
                }
                onClick={() =>
                  onUpdatePreset(preset.id, {
                    launcherId,
                    customCommand:
                      launcherId === "custom"
                        ? (preset.customCommand ?? "")
                        : null,
                  })
                }
                className={cn(
                  "flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 text-[11px] font-medium outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50",
                  selected
                    ? "border-primary/35 bg-primary/10 text-foreground"
                    : "border-border/50 bg-background/30 text-muted-foreground hover:bg-accent hover:text-foreground",
                  !available && "border-dashed",
                )}
              >
                {launcherId !== "custom" ? (
                  <AgentIcon
                    agent={launcherId}
                    size={13}
                    className="shrink-0"
                  />
                ) : null}
                <span className="truncate">{LAUNCHER_LABELS[launcherId]}</span>
                {!available ? (
                  <span
                    id={`agent-cli-${launcherId}-status`}
                    className="inline-flex shrink-0"
                  >
                    <span
                      className="size-1.5 rounded-full bg-destructive"
                      aria-hidden="true"
                    />
                    <span className="sr-only">Not available</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </fieldset>

      {preset.launcherId === "custom" ? (
        <div className="mt-2">
          <label
            htmlFor={`agent-preset-command-${preset.id}`}
            className="mb-1 block text-[11px] font-medium text-muted-foreground"
          >
            Custom start command
          </label>
          <Input
            id={`agent-preset-command-${preset.id}`}
            value={preset.customCommand ?? ""}
            disabled={loading}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={!customValidation.ok}
            aria-describedby={`agent-preset-command-${preset.id}-message`}
            onChange={(event) =>
              onUpdatePreset(preset.id, {
                launcherId: "custom",
                customCommand: event.currentTarget.value,
              })
            }
            className="h-8 rounded-md bg-input/40 px-2.5 font-mono text-xs"
            placeholder="Enter a start command"
          />
          <p
            id={`agent-preset-command-${preset.id}-message`}
            className={cn(
              "mt-1 min-h-4 text-[10px]",
              customValidation.ok
                ? "text-muted-foreground"
                : "text-destructive",
            )}
          >
            {customValidation.ok
              ? "The command opens in the workstation root."
              : customValidation.error}
          </p>
        </div>
      ) : null}

      <div className="mt-2 grid grid-cols-2 gap-1">
        {promptRequired ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={loading || !rootAvailable || !promptAvailable}
              onClick={() => onOpenPrompt(preset.id)}
              className="min-w-0 rounded-md"
            >
              <HugeiconsIcon icon={File02Icon} size={12} strokeWidth={1.8} />
              <span className="truncate">Open prompt</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={loading || !rootAvailable || !promptAvailable}
              onClick={() => onCopyStartupInstruction(preset.id)}
              className="min-w-0 rounded-md"
            >
              <HugeiconsIcon icon={Copy01Icon} size={12} strokeWidth={1.8} />
              <span className="truncate">Copy instruction</span>
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={loading || !rootAvailable}
          onClick={() => onOpenOutputs(preset.id)}
          className={cn("min-w-0 rounded-md", !promptRequired && "col-span-2")}
        >
          <HugeiconsIcon icon={FolderOpenIcon} size={12} strokeWidth={1.8} />
          <span className="truncate">Outputs</span>
        </Button>
      </div>

      {blockingMessage ? (
        <p className="mt-2 text-[10px] text-destructive" role="status">
          {blockingMessage}
        </p>
      ) : !error && selectedCliStatus?.available ? (
        <p className="mt-2 text-[10px] text-muted-foreground" role="status">
          Ready to launch in the workstation root.
        </p>
      ) : null}

      <fieldset className="mt-1.5">
        <legend className="mb-1 text-[10px] font-medium text-muted-foreground">
          Launch target
        </legend>
        <div className="grid grid-cols-2 gap-1">
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => onLaunch(preset.id)}
            className="min-w-0 rounded-md"
            aria-label={`Launch ${preset.name} in a new tab`}
          >
            <HugeiconsIcon icon={PlayIcon} size={13} strokeWidth={2} />
            <span className="truncate">New tab</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !focusedPane.available}
            onClick={() => onLaunchInPane(preset.id)}
            className="min-w-0 rounded-md"
            aria-label={`Launch ${preset.name} in the focused pane`}
            title={focusedPane.reason}
          >
            <HugeiconsIcon
              icon={LayoutTwoColumnIcon}
              size={13}
              strokeWidth={1.8}
            />
            <span className="truncate">Focused pane</span>
          </Button>
        </div>
      </fieldset>
    </div>
  );
}

type LaunchRequirements = {
  preset: WorkstationAgentPreset;
  cliAvailability?: AgentPresetPanelProps["cliAvailability"];
  promptAvailability?: AgentPresetAvailability;
  rootAvailable: boolean;
};

export function launchBlockingMessage({
  preset,
  cliAvailability,
  promptAvailability,
  rootAvailable,
}: LaunchRequirements): string | null {
  if (!rootAvailable) return "The workstation folder is unavailable.";
  if (preset.promptFile && promptAvailability?.available === false) {
    return promptAvailability.reason ?? "The preset prompt file is missing.";
  }
  if (preset.launcherId === "custom") {
    const result = validatePresetCustomCommand(preset.customCommand);
    return result.ok ? null : result.error;
  }
  const status = cliAvailability?.[preset.launcherId];
  if (status?.available) return null;
  return (
    status?.reason ??
    `${LAUNCHER_LABELS[preset.launcherId]} is not available on PATH.`
  );
}

function isRenderablePreset(value: unknown): value is WorkstationAgentPreset {
  if (!value || typeof value !== "object") return false;
  const preset = value as Partial<WorkstationAgentPreset>;
  return (
    isAfflowAgentPresetId(preset.id) &&
    typeof preset.name === "string" &&
    preset.name.trim().length > 0 &&
    isAfflowPresetLauncherId(preset.launcherId) &&
    (preset.customCommand === null ||
      typeof preset.customCommand === "string") &&
    (preset.promptFile === null || typeof preset.promptFile === "string")
  );
}
