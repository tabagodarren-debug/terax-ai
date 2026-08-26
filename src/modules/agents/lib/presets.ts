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

export const MAX_CUSTOM_AGENT_PRESETS = 12;
export const MAX_AGENT_PRESET_NAME_LENGTH = 64;
export const MAX_AGENT_PRESET_PROMPT_BYTES = 128 * 1024;

export const AFFLOW_PRESET_LAUNCHER_IDS = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "custom",
] as const;

export type BuiltInAgentPresetId = (typeof AFFLOW_AGENT_PRESET_IDS)[number];
export type CustomAgentPresetId = `preset-${string}`;
export type AfflowAgentPresetId = BuiltInAgentPresetId | CustomAgentPresetId;
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

const CUSTOM_PRESET_ID_PATTERN = /^preset-[a-z0-9]{6,24}-[a-z0-9]{4,12}$/;

export type NewAgentPresetInput = {
  name: string;
  prompt: string;
};

export type NewAgentPresetValidation =
  | { ok: true; name: string; prompt: string }
  | { ok: false; error: string };

export function createDefaultWorkstationAgentPresets(): WorkstationAgentPreset[] {
  return DEFAULT_WORKSTATION_AGENT_PRESETS.map((preset) => ({ ...preset }));
}

export function isAfflowAgentPresetId(
  value: unknown,
): value is AfflowAgentPresetId {
  return isBuiltInAgentPresetId(value) || isCustomAgentPresetId(value);
}

export function isBuiltInAgentPresetId(
  value: unknown,
): value is BuiltInAgentPresetId {
  return (
    typeof value === "string" &&
    (AFFLOW_AGENT_PRESET_IDS as readonly string[]).includes(value)
  );
}

export function isCustomAgentPresetId(
  value: unknown,
): value is CustomAgentPresetId {
  return typeof value === "string" && CUSTOM_PRESET_ID_PATTERN.test(value);
}

export function newCustomAgentPresetId(): CustomAgentPresetId {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function customAgentPresetPromptFile(id: CustomAgentPresetId): string {
  return `agents/custom/${id}/prompt.md`;
}

export function validateNewAgentPresetInput(
  value: NewAgentPresetInput,
): NewAgentPresetValidation {
  const name = value.name.trim();
  if (!name) return { ok: false, error: "Preset name is required." };
  if (name.length > MAX_AGENT_PRESET_NAME_LENGTH) {
    return {
      ok: false,
      error: `Keep the preset name under ${MAX_AGENT_PRESET_NAME_LENGTH} characters.`,
    };
  }
  if (/\p{Cc}/u.test(name)) {
    return { ok: false, error: "Preset name contains control characters." };
  }
  if (!value.prompt.trim()) {
    return { ok: false, error: "Paste the agent prompt markdown." };
  }
  if (
    new TextEncoder().encode(value.prompt).length >
    MAX_AGENT_PRESET_PROMPT_BYTES
  ) {
    return {
      ok: false,
      error: "Keep the prompt under 128 KB.",
    };
  }
  return { ok: true, name, prompt: value.prompt };
}

export function createCustomWorkstationAgentPreset(
  name: string,
  id = newCustomAgentPresetId(),
): WorkstationAgentPreset {
  return {
    id,
    name: name.trim(),
    launcherId: "claude",
    customCommand: null,
    promptFile: customAgentPresetPromptFile(id),
  };
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
  const id = raw.id;
  const expectedPrompt = isCustomAgentPresetId(id)
    ? customAgentPresetPromptFile(id)
    : defaultsById.get(id)?.promptFile;
  if (expectedPrompt === undefined) {
    return { ok: false, error: "Preset role is not supported." };
  }
  if (raw.promptFile !== expectedPrompt) {
    return { ok: false, error: "Preset prompt path does not match its role." };
  }
  if (raw.launcherId === "custom") {
    const result = validatePresetCustomCommand(raw.customCommand);
    if (!result.ok) return result;
    return {
      ok: true,
      preset: {
        id,
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
      id,
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
  const firstById = new Map<BuiltInAgentPresetId, unknown>();
  const customPresets: WorkstationAgentPreset[] = [];
  const customIds = new Set<CustomAgentPresetId>();
  if (Array.isArray(value)) {
    for (const candidate of value) {
      if (!candidate || typeof candidate !== "object") continue;
      const id = (candidate as Record<string, unknown>).id;
      if (isBuiltInAgentPresetId(id) && !firstById.has(id)) {
        firstById.set(id, candidate);
        continue;
      }
      if (
        isCustomAgentPresetId(id) &&
        !customIds.has(id) &&
        customPresets.length < MAX_CUSTOM_AGENT_PRESETS
      ) {
        const normalized = normalizeCustomPreset(candidate, id);
        if (!normalized) continue;
        customIds.add(id);
        customPresets.push(normalized);
      }
    }
  }
  return [
    ...DEFAULT_WORKSTATION_AGENT_PRESETS.map((fallback) =>
      normalizePreset(firstById.get(fallback.id), fallback),
    ),
    ...customPresets,
  ];
}

function normalizeCustomPreset(
  value: unknown,
  id: CustomAgentPresetId,
): WorkstationAgentPreset | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > MAX_AGENT_PRESET_NAME_LENGTH) return null;
  if (/\p{Cc}/u.test(name)) return null;
  if (raw.promptFile !== customAgentPresetPromptFile(id)) return null;
  if (!isAfflowPresetLauncherId(raw.launcherId)) return null;
  if (raw.launcherId !== "custom") {
    return {
      id,
      name,
      launcherId: raw.launcherId,
      customCommand: null,
      promptFile: customAgentPresetPromptFile(id),
    };
  }
  const custom = validatePresetCustomCommand(raw.customCommand);
  return {
    id,
    name,
    launcherId: "custom",
    customCommand: custom.ok
      ? custom.command
      : typeof raw.customCommand === "string"
        ? raw.customCommand.trim()
        : null,
    promptFile: customAgentPresetPromptFile(id),
  };
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
