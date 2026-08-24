import {
  type AgentCommandValidation,
  type AgentLaunchCommands,
  validateAgentLaunchCommand,
} from "@/modules/agents/lib/launcher";

export const AFFLOW_AGENT_PRESET_IDS = [
  "general",
  "script-generator",
  "script-reviewer",
  "video-prompt",
] as const;

export const AFFLOW_PRESET_LAUNCHER_IDS = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "custom",
] as const;

export type AfflowAgentPresetId = (typeof AFFLOW_AGENT_PRESET_IDS)[number];
export type AfflowPresetLauncherId =
  (typeof AFFLOW_PRESET_LAUNCHER_IDS)[number];

export type WorkstationAgentPreset = {
  id: AfflowAgentPresetId;
  name: string;
  launcherId: AfflowPresetLauncherId;
  customCommand: string | null;
  promptFile: string | null;
};

export const DEFAULT_WORKSTATION_AGENT_PRESETS = [
  {
    id: "general",
    name: "General Agent",
    launcherId: "claude",
    customCommand: null,
    promptFile: null,
  },
  {
    id: "script-generator",
    name: "Script Generator",
    launcherId: "claude",
    customCommand: null,
    promptFile: "agents/script-generator/prompt.md",
  },
  {
    id: "script-reviewer",
    name: "Script Reviewer",
    launcherId: "claude",
    customCommand: null,
    promptFile: "agents/script-reviewer/prompt.md",
  },
  {
    id: "video-prompt",
    name: "Image-to-Video Prompt Generator",
    launcherId: "claude",
    customCommand: null,
    promptFile: "agents/video-prompt/prompt.md",
  },
] as const satisfies readonly WorkstationAgentPreset[];

export type AgentPresetValidation =
  | { ok: true; preset: WorkstationAgentPreset }
  | { ok: false; error: string };

const defaultsById = new Map(
  DEFAULT_WORKSTATION_AGENT_PRESETS.map((preset) => [preset.id, preset]),
);

export function createDefaultWorkstationAgentPresets(): WorkstationAgentPreset[] {
  return DEFAULT_WORKSTATION_AGENT_PRESETS.map((preset) => ({ ...preset }));
}

export function isAfflowAgentPresetId(
  value: unknown,
): value is AfflowAgentPresetId {
  return (
    typeof value === "string" &&
    (AFFLOW_AGENT_PRESET_IDS as readonly string[]).includes(value)
  );
}

export function isAfflowPresetLauncherId(
  value: unknown,
): value is AfflowPresetLauncherId {
  return (
    typeof value === "string" &&
    (AFFLOW_PRESET_LAUNCHER_IDS as readonly string[]).includes(value)
  );
}

export function validatePresetCustomCommand(
  value: unknown,
): AgentCommandValidation {
  return validateAgentLaunchCommand(value);
}

export function validateWorkstationAgentPreset(
  value: unknown,
): AgentPresetValidation {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Preset must be an object." };
  }
  const raw = value as Record<string, unknown>;
  if (!isAfflowAgentPresetId(raw.id)) {
    return { ok: false, error: "Preset role is not supported." };
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    return { ok: false, error: "Preset name cannot be empty." };
  }
  if (!isAfflowPresetLauncherId(raw.launcherId)) {
    return { ok: false, error: "Preset launcher is not supported." };
  }
  const expectedPrompt = defaultsById.get(raw.id)?.promptFile ?? null;
  if (raw.promptFile !== expectedPrompt) {
    return { ok: false, error: "Preset prompt path does not match its role." };
  }
  if (raw.launcherId === "custom") {
    const result = validatePresetCustomCommand(raw.customCommand);
    if (!result.ok) return result;
    return {
      ok: true,
      preset: {
        id: raw.id,
        name: raw.name.trim(),
        launcherId: raw.launcherId,
        customCommand: result.command,
        promptFile: expectedPrompt,
      },
    };
  }
  if (raw.customCommand !== null) {
    return {
      ok: false,
      error: "Built-in launchers cannot override their global command.",
    };
  }
  return {
    ok: true,
    preset: {
      id: raw.id,
      name: raw.name.trim(),
      launcherId: raw.launcherId,
      customCommand: null,
      promptFile: expectedPrompt,
    },
  };
}

function normalizePreset(
  value: unknown,
  fallback: WorkstationAgentPreset,
): WorkstationAgentPreset {
  if (!value || typeof value !== "object") return { ...fallback };
  const raw = value as Record<string, unknown>;
  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : fallback.name;
  const launcherId = isAfflowPresetLauncherId(raw.launcherId)
    ? raw.launcherId
    : fallback.launcherId;
  if (launcherId === "custom") {
    const custom = validatePresetCustomCommand(raw.customCommand);
    if (custom.ok) {
      return {
        id: fallback.id,
        name,
        launcherId,
        customCommand: custom.command,
        promptFile: fallback.promptFile,
      };
    }
    return {
      id: fallback.id,
      name,
      launcherId,
      customCommand:
        typeof raw.customCommand === "string" && !raw.customCommand.trim()
          ? ""
          : null,
      promptFile: fallback.promptFile,
    };
  }
  return {
    id: fallback.id,
    name,
    launcherId,
    customCommand: null,
    promptFile: fallback.promptFile,
  };
}

export function normalizeWorkstationAgentPresets(
  value: unknown,
): WorkstationAgentPreset[] {
  const firstById = new Map<AfflowAgentPresetId, unknown>();
  if (Array.isArray(value)) {
    for (const candidate of value) {
      if (!candidate || typeof candidate !== "object") continue;
      const id = (candidate as Record<string, unknown>).id;
      if (isAfflowAgentPresetId(id) && !firstById.has(id)) {
        firstById.set(id, candidate);
      }
    }
  }
  return DEFAULT_WORKSTATION_AGENT_PRESETS.map((fallback) =>
    normalizePreset(firstById.get(fallback.id), fallback),
  );
}

export function startupInstructionForPreset(
  preset: WorkstationAgentPreset,
): string | null {
  return preset.promptFile
    ? `Read and follow the instructions in ${preset.promptFile} before starting.`
    : null;
}

export function resolveWorkstationAgentCommand(
  preset: WorkstationAgentPreset,
  globalCommands: AgentLaunchCommands,
): AgentCommandValidation {
  return validateAgentLaunchCommand(
    preset.launcherId === "custom"
      ? preset.customCommand
      : globalCommands[preset.launcherId],
  );
}
