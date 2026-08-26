import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { fmtShortcut, MOD_KEY, SHIFT_KEY } from "@/lib/platform";
import { AgentLauncherPanel } from "@/modules/agents/components/AgentLauncherPanel";
import { CreateAgentPresetDialog } from "@/modules/agents/components/CreateAgentPresetDialog";
import {
  AgentPresetPanel,
  type AgentPresetPanelProps,
} from "@/modules/agents/components/AgentPresetPanel";
import type { AgentLaunchRequest } from "@/modules/agents/lib/launcher";
import type {
  NewAgentPresetInput,
  WorkstationAgentPreset,
} from "@/modules/agents/lib/presets";
import {
  AiBrowserIcon,
  ArrowRight01Icon,
  ComputerTerminal02Icon,
  GitBranchIcon,
  Globe02Icon,
  IncognitoIcon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

export type AgentPresetMenuConfig = Omit<
  AgentPresetPanelProps,
  "selectedPresetId" | "onSelect" | "onBack" | "onRequestCreatePreset"
> & {
  onCreatePreset: (
    input: NewAgentPresetInput,
  ) => Promise<WorkstationAgentPreset>;
};

type Props = {
  onNew: () => void;
  onNewBlock: () => void;
  onNewPrivate: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onNewGitGraph: () => void;
  onLaunchAgents: (request: AgentLaunchRequest) => void;
  agentPresets: AgentPresetMenuConfig;
};

export function NewTabMenu({
  onNew,
  onNewBlock,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onNewGitGraph,
  onLaunchAgents,
  agentPresets,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [createPresetOpen, setCreatePresetOpen] = useState(false);
  const [launcherView, setLauncherView] = useState<"presets" | "advanced">(
    "presets",
  );
  const [selectedPresetId, setSelectedPresetId] = useState(
    agentPresets.presets[0]?.id ?? null,
  );
  const openLauncherAfterMenuClose = useRef(false);
  const openMenuAfterLauncherClose = useRef(false);

  useEffect(() => {
    if (
      selectedPresetId &&
      agentPresets.presets.some((preset) => preset.id === selectedPresetId)
    ) {
      return;
    }
    setSelectedPresetId(agentPresets.presets[0]?.id ?? null);
  }, [agentPresets.presets, selectedPresetId]);

  const onMenuOpenChange = (next: boolean) => {
    if (next) {
      openLauncherAfterMenuClose.current = false;
      setLauncherOpen(false);
    }
    setMenuOpen(next);
  };

  const openLauncher = () => {
    setLauncherView("presets");
    openLauncherAfterMenuClose.current = true;
  };

  const backToMenu = () => {
    openMenuAfterLauncherClose.current = true;
    setLauncherOpen(false);
  };

  return (
    <Popover open={launcherOpen} onOpenChange={setLauncherOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="ml-1 size-6 shrink-0 rounded-full bg-foreground/[0.06] text-muted-foreground ring-1 ring-inset ring-foreground/[0.04] hover:bg-foreground/[0.12] hover:text-foreground"
                title="New tab"
              >
                <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-44"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (!openLauncherAfterMenuClose.current) return;

                openLauncherAfterMenuClose.current = false;
                requestAnimationFrame(() => setLauncherOpen(true));
              }}
            >
              <DropdownMenuItem onSelect={onNew}>
                <HugeiconsIcon
                  icon={ComputerTerminal02Icon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="flex-1">Terminal</span>
                <span className="text-xs text-muted-foreground">
                  {fmtShortcut(MOD_KEY, "T")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onNewBlock}>
                <HugeiconsIcon
                  icon={ComputerTerminal02Icon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="flex-1">Blocks</span>
                <span className="text-xs text-muted-foreground">
                  {fmtShortcut(MOD_KEY, SHIFT_KEY, "T")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={openLauncher}>
                <HugeiconsIcon
                  icon={AiBrowserIcon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="flex-1">Agents</span>
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={14}
                  strokeWidth={1.75}
                  className="text-muted-foreground"
                />
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onNewPrivate}>
                <HugeiconsIcon
                  icon={IncognitoIcon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="flex-1">Privacy</span>
                <span className="text-xs text-muted-foreground">
                  {fmtShortcut(MOD_KEY, "R")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onNewEditor}>
                <HugeiconsIcon
                  icon={PencilEdit02Icon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="flex-1">Editor</span>
                <span className="text-xs text-muted-foreground">
                  {fmtShortcut(MOD_KEY, "E")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onNewPreview}>
                <HugeiconsIcon
                  icon={Globe02Icon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="flex-1">Preview</span>
                <span className="text-xs text-muted-foreground">
                  {fmtShortcut(MOD_KEY, "P")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onNewGitGraph}>
                <HugeiconsIcon
                  icon={GitBranchIcon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="flex-1">Git Graph</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={6}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!openMenuAfterLauncherClose.current) return;

          openMenuAfterLauncherClose.current = false;
          requestAnimationFrame(() => setMenuOpen(true));
        }}
        className="max-h-[calc(100vh-24px)] w-[420px] max-w-[calc(100vw-16px)] gap-0 overflow-y-auto rounded-lg p-1.5"
      >
        {launcherView === "presets" ? (
          <>
            <AgentPresetPanel
              {...agentPresets}
              selectedPresetId={selectedPresetId}
              onSelect={setSelectedPresetId}
              onBack={backToMenu}
              onRequestCreatePreset={() => {
                setLauncherOpen(false);
                setCreatePresetOpen(true);
              }}
              onLaunch={(presetId) => {
                setLauncherOpen(false);
                agentPresets.onLaunch(presetId);
              }}
              onLaunchInPane={(presetId) => {
                setLauncherOpen(false);
                agentPresets.onLaunchInPane(presetId);
              }}
              onOpenPrompt={(presetId) => {
                setLauncherOpen(false);
                agentPresets.onOpenPrompt(presetId);
              }}
              onOpenOutputs={(presetId) => {
                setLauncherOpen(false);
                agentPresets.onOpenOutputs(presetId);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="mt-1 w-full justify-between rounded-md text-muted-foreground"
              onClick={() => setLauncherView("advanced")}
            >
              Advanced multi-pane launcher
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={13}
                strokeWidth={1.75}
              />
            </Button>
          </>
        ) : (
          <AgentLauncherPanel
            onBack={() => setLauncherView("presets")}
            onLaunch={(request) => {
              setLauncherOpen(false);
              onLaunchAgents(request);
            }}
          />
        )}
      </PopoverContent>
      <CreateAgentPresetDialog
        open={createPresetOpen}
        onOpenChange={setCreatePresetOpen}
        onCreate={async (input) => {
          const preset = await agentPresets.onCreatePreset(input);
          setSelectedPresetId(preset.id);
        }}
      />
    </Popover>
  );
}
