import {
  type AfflowAgentPresetId,
  createDefaultWorkstationAgentPresets,
  type WorkstationAgentPreset,
} from "@/modules/agents/lib/presets";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AgentPresetPanel,
  type AgentPresetPanelProps,
  launchBlockingMessage,
} from "./AgentPresetPanel";

function createProps(
  overrides: Partial<AgentPresetPanelProps> = {},
): AgentPresetPanelProps {
  return {
    presets: createDefaultWorkstationAgentPresets(),
    selectedPresetId: "script-generator",
    cliAvailability: {
      claude: { available: true },
      codex: { available: true },
      gemini: { available: false },
      opencode: { available: false },
    },
    promptAvailability: {
      "script-generator": { available: true },
      "script-reviewer": { available: true },
      "video-prompt": { available: true },
    },
    workstationRoot: "C:\\Workstations\\Creator",
    onSelect: vi.fn(),
    onUpdatePreset: vi.fn(),
    onRequestCreatePreset: vi.fn(),
    onLaunch: vi.fn(),
    onLaunchInPane: vi.fn(),
    focusedPane: { available: true },
    onOpenPrompt: vi.fn(),
    onCopyStartupInstruction: vi.fn(),
    onOpenOutputs: vi.fn(),
    ...overrides,
  };
}

function html(overrides: Partial<AgentPresetPanelProps> = {}) {
  return renderToStaticMarkup(<AgentPresetPanel {...createProps(overrides)} />);
}

function preset(
  id: AfflowAgentPresetId,
  overrides: Partial<WorkstationAgentPreset> = {},
) {
  const value = createDefaultWorkstationAgentPresets().find(
    (candidate) => candidate.id === id,
  );
  if (!value) throw new Error(`Missing preset ${id}`);
  return { ...value, ...overrides };
}

type TestElement = ReactElement<Record<string, unknown>>;

function childElements(node: ReactNode): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(childElements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as TestElement;
  return [element, ...childElements(element.props.children as ReactNode)];
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return `${node}`;
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  return textContent(
    (node as ReactElement<{ children?: ReactNode }>).props.children,
  );
}

function controls(props: AgentPresetPanelProps): TestElement {
  const panel = AgentPresetPanel(props);
  const controlsElement = childElements(panel).find(
    (element) =>
      typeof element.type === "function" &&
      element.type.name === "PresetControls",
  );
  if (!controlsElement || typeof controlsElement.type !== "function") {
    throw new Error("Preset controls were not rendered");
  }
  const renderControls = controlsElement.type as (
    props: Record<string, unknown>,
  ) => TestElement;
  return renderControls(controlsElement.props);
}

function findControl(root: TestElement, label: string): TestElement {
  const element = childElements(root).find(
    (candidate) =>
      textContent(candidate.props.children as ReactNode).trim() === label,
  );
  if (!element) throw new Error(`Missing control ${label}`);
  return element;
}

function click(element: TestElement | undefined) {
  if (element?.props.disabled === true) return;
  (element?.props.onClick as (() => void) | undefined)?.();
}

function change(element: TestElement | undefined, value: string) {
  const onChange = element?.props.onChange as
    | ((event: { currentTarget: { value: string } }) => void)
    | undefined;
  onChange?.({ currentTarget: { value } });
}

describe("AgentPresetPanel", () => {
  it("renders all four workflow roles independently from CLI brands", () => {
    const markup = html();

    expect(markup).toContain("General Agent");
    expect(markup).toContain("Script Generator");
    expect(markup).toContain("Script Reviewer");
    expect(markup).toContain("Image-to-Video Prompt Generator");
    expect(markup).toContain("Command line tool");
    expect(markup).toContain("Claude");
    expect(markup).toContain("Codex");
    expect(markup).toContain("Gemini");
    expect(markup).toContain("OpenCode");
    expect(markup).toContain("Custom");
  });

  it("selects roles by id through semantic keyboard-operable buttons", () => {
    const props = createProps();
    const panel = AgentPresetPanel(props);
    const role = childElements(panel).find(
      (element) =>
        element.type === "button" &&
        textContent(element.props.children as ReactNode).includes(
          "Script Reviewer",
        ),
    );

    expect(role?.props.type).toBe("button");
    expect(role?.props["aria-pressed"]).toBe(false);
    click(role);
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith("script-reviewer");
    expect(html()).toContain("<fieldset");
  });

  it("updates built-in and custom CLI selection with exact preset ids", () => {
    const props = createProps();
    const root = controls(props);

    click(findControl(root, "Codex"));
    click(findControl(root, "Custom"));

    expect(props.onUpdatePreset).toHaveBeenNthCalledWith(
      1,
      "script-generator",
      { launcherId: "codex", customCommand: null },
    );
    expect(props.onUpdatePreset).toHaveBeenNthCalledWith(
      2,
      "script-generator",
      { launcherId: "custom", customCommand: "" },
    );
  });

  it("validates and updates a custom command without native calls", () => {
    const customPreset = preset("script-generator", {
      launcherId: "custom",
      customCommand: "",
    });
    const invalidProps = createProps({ presets: [customPreset] });
    const invalidMarkup = html({ presets: [customPreset] });
    const invalidRoot = controls(invalidProps);
    const input = childElements(invalidRoot).find(
      (element) => element.props.id === "agent-preset-command-script-generator",
    );

    expect(invalidMarkup).toContain("Enter a start command.");
    expect(invalidMarkup).toContain("disabled");
    change(input, "  my-agent --safe  ");
    expect(invalidProps.onUpdatePreset).toHaveBeenCalledExactlyOnceWith(
      "script-generator",
      { launcherId: "custom", customCommand: "  my-agent --safe  " },
    );

    const validMarkup = html({
      presets: [{ ...customPreset, customCommand: "my-agent --safe" }],
    });
    expect(validMarkup).toContain("Ready to launch in the workstation root.");
    expect(validMarkup).not.toContain("Enter a start command.");
  });

  it("omits prompt actions for General while retaining outputs and launch", () => {
    const markup = html({ selectedPresetId: "general" });

    expect(markup).not.toContain("Open prompt");
    expect(markup).not.toContain("Copy instruction");
    expect(markup).toContain("Outputs");
    expect(markup).toContain("Launch General Agent");
  });

  it("invokes specialized role commands with the exact selected id", () => {
    const props = createProps();
    const root = controls(props);

    click(findControl(root, "Open prompt"));
    click(findControl(root, "Copy instruction"));
    click(findControl(root, "Outputs"));
    click(findControl(root, "New tab"));
    click(findControl(root, "Focused pane"));

    expect(props.onOpenPrompt).toHaveBeenCalledExactlyOnceWith(
      "script-generator",
    );
    expect(props.onCopyStartupInstruction).toHaveBeenCalledExactlyOnceWith(
      "script-generator",
    );
    expect(props.onOpenOutputs).toHaveBeenCalledExactlyOnceWith(
      "script-generator",
    );
    expect(props.onLaunch).toHaveBeenCalledExactlyOnceWith("script-generator");
    expect(props.onLaunchInPane).toHaveBeenCalledExactlyOnceWith(
      "script-generator",
    );
  });

  it("requests custom preset creation from the panel header", () => {
    const props = createProps();
    const panel = AgentPresetPanel(props);

    click(findControl(panel, "New preset"));

    expect(props.onRequestCreatePreset).toHaveBeenCalledOnce();
  });

  it("disables focused-pane launch until a split pane is available", () => {
    const props = createProps({
      focusedPane: {
        available: false,
        reason: "Split the terminal right or down first.",
      },
    });
    const focusedPane = findControl(controls(props), "Focused pane");

    expect(focusedPane.props.disabled).toBe(true);
    expect(focusedPane.props.title).toBe(
      "Split the terminal right or down first.",
    );
    click(focusedPane);
    expect(props.onLaunchInPane).not.toHaveBeenCalled();
  });

  it("surfaces unavailable CLI, missing root, and missing prompt states", () => {
    expect(
      html({
        cliAvailability: {
          claude: { available: false, reason: "Claude was not detected." },
        },
      }),
    ).toContain("Claude was not detected.");
    expect(html({ workstationRoot: null })).toContain(
      "The workstation folder is unavailable.",
    );
    expect(
      html({
        promptAvailability: {
          "script-generator": {
            available: false,
            reason: "The Script Generator prompt is missing.",
          },
        },
      }),
    ).toContain("The Script Generator prompt is missing.");
  });

  it("keeps unavailable CLIs actionable while disabling broken launches", () => {
    const props = createProps({
      cliAvailability: { codex: { available: false } },
    });
    const unavailablePreset = preset("script-generator", {
      launcherId: "codex",
    });
    const markup = html({
      presets: [unavailablePreset],
      cliAvailability: { codex: { available: false } },
    });
    const root = controls(props);
    const codex = findControl(root, "Codex");

    expect(codex.props.disabled).not.toBe(true);
    expect(markup).toContain("Codex is not available on PATH.");
    expect(markup).toContain("Not available");
    expect(markup).toContain("disabled");
  });

  it("represents loading, error, empty, malformed, and no-selection states", () => {
    expect(html({ loading: true })).toContain('aria-busy="true"');
    expect(html({ loading: true })).toContain("Loading");
    expect(html({ error: "CLI detection failed." })).toContain('role="alert"');
    expect(html({ error: "CLI detection failed." })).toContain(
      "CLI detection failed.",
    );
    expect(html({ presets: [] })).toContain("No agent presets");
    expect(
      html({
        presets: [
          null,
          { id: "unknown" },
        ] as unknown as WorkstationAgentPreset[],
      }),
    ).toContain("Workstation presets could not be loaded.");
    expect(html({ selectedPresetId: null })).toContain(
      "Choose a workflow role to configure it.",
    );
  });

  it("provides an accessible optional back control", () => {
    const onBack = vi.fn();
    const props = createProps({ onBack });
    const panel = AgentPresetPanel(props);
    const back = childElements(panel).find(
      (element) => element.props["aria-label"] === "Back to new tab menu",
    );

    expect(html({ onBack })).toContain('aria-label="Back to new tab menu"');
    expect(back?.props.type).toBe("button");
    click(back);
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe("launchBlockingMessage", () => {
  it("uses the shared custom validator and prompt/root availability", () => {
    expect(
      launchBlockingMessage({
        preset: preset("video-prompt", {
          launcherId: "custom",
          customCommand: "\n",
        }),
        rootAvailable: true,
      }),
    ).toBe("Enter a start command.");
    expect(
      launchBlockingMessage({
        preset: preset("video-prompt"),
        rootAvailable: false,
      }),
    ).toBe("The workstation folder is unavailable.");
  });
});
