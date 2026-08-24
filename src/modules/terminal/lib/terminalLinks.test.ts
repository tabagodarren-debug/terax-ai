import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import {
  activateTerminalFileReference,
  createTerminalFileLinkProvider,
  createTerminalFileLinks,
  createTerminalLinkHandler,
  findWorkstationFileReferences,
  parseWorkstationFileReference,
  setTerminalFileLinkHandler,
  WORKSTATION_FILE_ROOTS,
} from "./terminalLinks";

afterEach(() => {
  vi.clearAllMocks();
  setTerminalFileLinkHandler(null);
});

describe("createTerminalLinkHandler", () => {
  it("opens OSC 8 links natively and restores late-bound terminal focus", async () => {
    openUrl.mockResolvedValue(undefined);
    const initialFocus = vi.fn();
    let focus = initialFocus;
    const handler = createTerminalLinkHandler(() => focus());
    focus = vi.fn();

    handler.activate(
      {} as MouseEvent,
      "https://chatgpt.com/codex/settings/usage",
    );

    expect(openUrl).toHaveBeenCalledWith(
      "https://chatgpt.com/codex/settings/usage",
    );
    await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
    expect(initialFocus).not.toHaveBeenCalled();
  });
});

describe("parseWorkstationFileReference", () => {
  it.each(WORKSTATION_FILE_ROOTS)("accepts the %s scaffold root", (root) => {
    expect(parseWorkstationFileReference(`${root}/nested/result.md`)).toEqual({
      relativePath: `${root}/nested/result.md`,
    });
  });

  it("accepts a one-based line suffix", () => {
    expect(parseWorkstationFileReference("outputs/report.md:42")).toEqual({
      relativePath: "outputs/report.md",
      line: 42,
    });
  });

  it("accepts an explicit extensionless leaf", () => {
    expect(parseWorkstationFileReference("scripts/render")).toEqual({
      relativePath: "scripts/render",
    });
  });

  it.each([
    "",
    "outputs/",
    "outputs/archive.v1/",
    "outputs//report.md",
    "outputs/./report.md",
    "outputs/../report.md",
    "../outputs/report.md",
    "/outputs/report.md",
    "C:/outputs/report.md",
    "C:outputs/report.md",
    "C:\\outputs\\report.md",
    "outputs\\report.md",
    "https://example.com/outputs/report.md",
    "file://outputs/report.md",
    "outputs/report.md:0",
    "outputs/report.md:-1",
    "outputs/report.md:2147483648",
    "outputs/report.md:12:13",
    "outputs/report.md\n",
    "outputs/re\u0000port.md",
    "other/report.md",
  ])("rejects %j", (token) => {
    expect(parseWorkstationFileReference(token)).toBeNull();
  });

  it("caps reference length", () => {
    expect(
      parseWorkstationFileReference(`outputs/${"a".repeat(502)}.md`),
    ).toBeNull();
  });
});

describe("findWorkstationFileReferences", () => {
  it("honors prose punctuation boundaries and strips sentence punctuation", () => {
    const text = "See (outputs/report.md:42), then `scripts/render.ts`. Done.";
    expect(findWorkstationFileReferences(text)).toEqual([
      {
        relativePath: "outputs/report.md",
        line: 42,
        start: text.indexOf("outputs/"),
        end: text.indexOf("outputs/") + "outputs/report.md:42".length,
      },
      {
        relativePath: "scripts/render.ts",
        start: text.indexOf("scripts/"),
        end: text.indexOf("scripts/") + "scripts/render.ts".length,
      },
    ]);
  });

  it("finds multiple references on one line", () => {
    expect(
      findWorkstationFileReferences(
        "agents/researcher/prompt.md outputs/summary.md images/chart.png",
      ).map(({ relativePath, line }) => ({ relativePath, line })),
    ).toEqual([
      { relativePath: "agents/researcher/prompt.md", line: undefined },
      { relativePath: "outputs/summary.md", line: undefined },
      { relativePath: "images/chart.png", line: undefined },
    ]);
  });

  it.each([
    "prefixoutputs/report.md",
    "https://example.com/outputs/report.md",
    "file://outputs/report.md",
    "/outputs/report.md",
    "C:/outputs/report.md",
    "C:outputs/report.md",
    "file:outputs/report.md",
    "outputs/report.md$Suffix",
    "outputs/report.md\\more",
    "outputs/../secret.md",
  ])("does not link ambiguous or unsafe prose %j", (text) => {
    expect(findWorkstationFileReferences(text)).toEqual([]);
  });
});

describe("terminal file link adapter", () => {
  it("builds one-based inclusive xterm ranges", () => {
    const activate = vi.fn();
    const links = createTerminalFileLinks(
      "go outputs/report.md:7 now",
      13,
      activate,
    );

    expect(links).toHaveLength(1);
    expect(links?.[0]).toMatchObject({
      text: "outputs/report.md:7",
      range: {
        start: { x: 4, y: 13 },
        end: { x: 22, y: 13 },
      },
    });
    links?.[0].activate({} as MouseEvent, links[0].text);
    expect(activate).toHaveBeenCalledWith({
      relativePath: "outputs/report.md",
      line: 7,
    });
  });

  it("sends the current leaf id and parsed reference to the callback", () => {
    const handler = vi.fn();
    setTerminalFileLinkHandler(handler);

    expect(
      activateTerminalFileReference(
        { relativePath: "agents/coder/prompt.md", line: 9 },
        () => 41,
      ),
    ).toBe(true);
    expect(handler).toHaveBeenCalledWith({
      leafId: 41,
      relativePath: "agents/coder/prompt.md",
      line: 9,
    });
  });

  it("resolves a rebound renderer slot at activation time", () => {
    let leafId: number | null = 7;
    const handler = vi.fn();
    setTerminalFileLinkHandler(handler);
    const provider = createTerminalFileLinkProvider(
      () => "outputs/final.md",
      () => leafId,
    );
    let links: ReturnType<typeof createTerminalFileLinks>;
    provider.provideLinks(3, (provided) => {
      links = provided;
    });

    leafId = 22;
    links?.[0].activate({} as MouseEvent, links[0].text);

    expect(handler).toHaveBeenCalledWith({
      leafId: 22,
      relativePath: "outputs/final.md",
    });
    expect(handler).not.toHaveBeenCalledWith(
      expect.objectContaining({ leafId: 7 }),
    );
  });

  it("does nothing when a slot has no current leaf or no configured handler", () => {
    const handler = vi.fn();
    setTerminalFileLinkHandler(handler);
    expect(
      activateTerminalFileReference(
        { relativePath: "outputs/final.md" },
        () => null,
      ),
    ).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    setTerminalFileLinkHandler(null);
    expect(
      activateTerminalFileReference(
        { relativePath: "outputs/final.md" },
        () => 3,
      ),
    ).toBe(false);
  });
});
