import {
  type AgentLaunchCommands,
  DEFAULT_AGENT_LAUNCH_COMMANDS,
} from "@/modules/agents/lib/launcher";
import { describe, expect, it } from "vitest";
import {
  AFFLOW_AGENT_PRESET_IDS,
  createCustomWorkstationAgentPreset,
  createDefaultWorkstationAgentPresets,
  customAgentPresetPromptFile,
  DEFAULT_WORKSTATION_AGENT_PRESETS,
  MAX_CUSTOM_AGENT_PRESETS,
  newCustomAgentPresetId,
  normalizeWorkstationAgentPresets,
  resolveWorkstationAgentCommand,
  startupInstructionForPreset,
  validateNewAgentPresetInput,
  validateWorkstationAgentPreset,
} from "./presets";

describe("workstation agent presets", () => {
  it("defines the four roles in stable order with canonical prompt paths", () => {
    expect(
      DEFAULT_WORKSTATION_AGENT_PRESETS.map((preset) => preset.id),
    ).toEqual(AFFLOW_AGENT_PRESET_IDS);
    expect(
      DEFAULT_WORKSTATION_AGENT_PRESETS.map((preset) => preset.promptFile),
    ).toEqual([
      null,
      "agents/script-generator/prompt.md",
      "agents/script-reviewer/prompt.md",
      "agents/video-prompt/prompt.md",
    ]);
  });

  it("returns fresh default objects", () => {
    const first = createDefaultWorkstationAgentPresets();
    const second = createDefaultWorkstationAgentPresets();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    for (const [index, preset] of first.entries()) {
      expect(preset).not.toBe(second[index]);
    }
  });

  it("normalizes missing, duplicate, and malformed records", () => {
    const presets = normalizeWorkstationAgentPresets([
      {
        id: "script-generator",
        name: "  My Writer  ",
        launcherId: "codex",
        customCommand: "ignored",
        promptFile: "../../escape.md",
      },
      {
        id: "script-generator",
        name: "Duplicate",
        launcherId: "gemini",
      },
      {
        id: "script-reviewer",
        name: " ",
        launcherId: "unknown",
      },
      { id: "unknown", name: "Ignored", launcherId: "claude" },
    ]);

    expect(presets).toEqual([
      DEFAULT_WORKSTATION_AGENT_PRESETS[0],
      {
        id: "script-generator",
        name: "My Writer",
        launcherId: "codex",
        customCommand: null,
        promptFile: "agents/script-generator/prompt.md",
      },
      DEFAULT_WORKSTATION_AGENT_PRESETS[2],
      DEFAULT_WORKSTATION_AGENT_PRESETS[3],
    ]);
  });

  it("preserves an incomplete custom selection but validates launch strictly", () => {
    const incomplete = normalizeWorkstationAgentPresets([
      {
        ...DEFAULT_WORKSTATION_AGENT_PRESETS[0],
        launcherId: "custom",
        customCommand: "  ",
      },
    ]);
    const valid = normalizeWorkstationAgentPresets([
      {
        ...DEFAULT_WORKSTATION_AGENT_PRESETS[0],
        launcherId: "custom",
        customCommand: "  my-agent --profile local  ",
      },
    ]);

    expect(incomplete[0]).toMatchObject({
      launcherId: "custom",
      customCommand: "",
    });
    expect(valid[0]).toMatchObject({
      launcherId: "custom",
      customCommand: "my-agent --profile local",
    });
    expect(
      resolveWorkstationAgentCommand(
        incomplete[0],
        DEFAULT_AGENT_LAUNCH_COMMANDS,
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateWorkstationAgentPreset({
        ...valid[0],
        customCommand: "bad\ncommand",
      }),
    ).toMatchObject({ ok: false });
  });

  it("resolves built-ins through global preferences and custom commands locally", () => {
    const commands: AgentLaunchCommands = {
      ...DEFAULT_AGENT_LAUNCH_COMMANDS,
      codex: "codex --model o3",
    };
    const builtIn = {
      ...DEFAULT_WORKSTATION_AGENT_PRESETS[1],
      launcherId: "codex" as const,
    };
    const custom = {
      ...DEFAULT_WORKSTATION_AGENT_PRESETS[0],
      launcherId: "custom" as const,
      customCommand: "afflow-agent",
    };

    expect(resolveWorkstationAgentCommand(builtIn, commands)).toEqual({
      ok: true,
      command: "codex --model o3",
    });
    expect(resolveWorkstationAgentCommand(custom, commands)).toEqual({
      ok: true,
      command: "afflow-agent",
    });
  });

  it("builds a copyable instruction only for specialized roles", () => {
    expect(
      startupInstructionForPreset(DEFAULT_WORKSTATION_AGENT_PRESETS[0]),
    ).toBeNull();
    expect(
      startupInstructionForPreset(DEFAULT_WORKSTATION_AGENT_PRESETS[3]),
    ).toBe(
      "Read and follow the instructions in agents/video-prompt/prompt.md before starting.",
    );
  });

  it("creates and restores safe workstation-relative custom presets", () => {
    const id = "preset-m123abc-9x8y7z" as const;
    const custom = createCustomWorkstationAgentPreset(
      "  Product Researcher  ",
      id,
    );
    const restored = normalizeWorkstationAgentPresets([custom]);

    expect(custom).toEqual({
      id,
      name: "Product Researcher",
      launcherId: "claude",
      customCommand: null,
      promptFile: customAgentPresetPromptFile(id),
    });
    expect(restored.slice(4)).toEqual([custom]);
    expect(startupInstructionForPreset(custom)).toBe(
      `Read and follow the instructions in ${custom.promptFile} before starting.`,
    );
  });

  it("drops custom presets with forged prompt paths and caps their count", () => {
    const custom = Array.from(
      { length: MAX_CUSTOM_AGENT_PRESETS + 2 },
      (_, index) => {
        const id = `preset-m123ab${index}-abcd${index}` as const;
        return createCustomWorkstationAgentPreset(`Preset ${index}`, id);
      },
    );
    const forged = {
      ...custom[0],
      id: "preset-m999999-escape",
      promptFile: "../../outside.md",
    };
    const normalized = normalizeWorkstationAgentPresets([forged, ...custom]);

    expect(normalized).toHaveLength(4 + MAX_CUSTOM_AGENT_PRESETS);
    expect(normalized.some((preset) => preset.id === forged.id)).toBe(false);
  });

  it("validates the two custom preset inputs", () => {
    expect(
      validateNewAgentPresetInput({
        name: "  Researcher  ",
        prompt: "# Role\n",
      }),
    ).toEqual({ ok: true, name: "Researcher", prompt: "# Role\n" });
    expect(validateNewAgentPresetInput({ name: "", prompt: "# Role" })).toEqual(
      {
        ok: false,
        error: "Preset name is required.",
      },
    );
    expect(
      validateNewAgentPresetInput({ name: "Researcher", prompt: " " }),
    ).toEqual({
      ok: false,
      error: "Paste the agent prompt markdown.",
    });
    expect(newCustomAgentPresetId()).toMatch(
      /^preset-[a-z0-9]{6,24}-[a-z0-9]{4,12}$/,
    );
  });
});
