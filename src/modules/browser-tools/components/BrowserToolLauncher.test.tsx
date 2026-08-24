import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  BrowserToolLauncher,
  type BrowserToolLauncherProps,
  displayBrowserToolUrl,
  isCurrentBrowserLauncherContext,
  moveBrowserToolIds,
} from "@/modules/browser-tools/components/BrowserToolLauncher";
import {
  normalizeBrowserToolDraft,
  validateBrowserToolDraft,
} from "@/modules/browser-tools/components/BrowserToolDialog";

const tools = [
  {
    id: "flow",
    name: "Google Flow",
    url: "https://labs.google/fx/tools/flow?source=afflow",
  },
  { id: "kling", name: "Kling", url: "https://klingai.com/" },
  { id: "grok", name: "Grok", url: "https://grok.com/" },
];

function props(
  overrides: Partial<BrowserToolLauncherProps> = {},
): BrowserToolLauncherProps {
  return {
    contextKey: "workstation-a:chrome:bp-a",
    tools,
    profileMode: "workstation",
    browser: {
      id: "chrome",
      name: "Google Chrome",
      status: "available",
      resolvedPath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    },
    profile: {
      activity: "idle",
      exists: true,
      profilePath: "C:/Afflow/profile/user-data",
    },
    openOnWorkstationLaunch: true,
    onLaunchAll: vi.fn(),
    onLaunchTool: vi.fn(),
    onProfileModeChange: vi.fn(),
    onAddTool: vi.fn(),
    onUpdateTool: vi.fn(),
    onRemoveTool: vi.fn(),
    onReorderTools: vi.fn(),
    onOpenOnWorkstationLaunchChange: vi.fn(),
    onOpenProfileFolder: vi.fn(),
    onResetProfile: vi.fn(),
    ...overrides,
  };
}

describe("moveBrowserToolIds", () => {
  it("moves an item one position without mutating input", () => {
    expect(moveBrowserToolIds(tools, "kling", "up")).toEqual([
      "kling",
      "flow",
      "grok",
    ]);
    expect(moveBrowserToolIds(tools, "kling", "down")).toEqual([
      "flow",
      "grok",
      "kling",
    ]);
    expect(tools.map((tool) => tool.id)).toEqual(["flow", "kling", "grok"]);
  });

  it("rejects missing items and boundary moves", () => {
    expect(moveBrowserToolIds(tools, "missing", "up")).toBeNull();
    expect(moveBrowserToolIds(tools, "flow", "up")).toBeNull();
    expect(moveBrowserToolIds(tools, "grok", "down")).toBeNull();
  });
});

describe("isCurrentBrowserLauncherContext", () => {
  it("rejects dialog actions after their launcher context changes", () => {
    expect(
      isCurrentBrowserLauncherContext(
        "workstation-a:chrome:bp-a",
        "workstation-a:chrome:bp-a",
      ),
    ).toBe(true);
    expect(
      isCurrentBrowserLauncherContext(
        "workstation-a:chrome:bp-a",
        "workstation-b:chrome:bp-b",
      ),
    ).toBe(false);
    expect(
      isCurrentBrowserLauncherContext(null, "workstation-a:chrome:bp-a"),
    ).toBe(false);
  });
});

describe("browser tool draft validation", () => {
  it("normalizes a valid name and URL", () => {
    const draft = { name: "  Flow  ", url: "  https://example.com/tool  " };
    expect(validateBrowserToolDraft(draft)).toEqual({});
    expect(normalizeBrowserToolDraft(draft)).toEqual({
      name: "Flow",
      url: "https://example.com/tool",
    });
  });

  it.each([
    [{ name: "", url: "https://example.com" }, "name"],
    [{ name: "Tool", url: "" }, "url"],
    [{ name: "Tool", url: "file:///tmp/tool" }, "url"],
    [{ name: "Tool", url: "https://user:secret@example.com" }, "url"],
    [{ name: "Tool\u0000", url: "https://example.com" }, "name"],
    [{ name: "Tool", url: "https://example.com/\u0000" }, "url"],
    [{ name: "Tool", url: "not a URL" }, "url"],
  ] as const)("rejects invalid draft %#", (draft, field) => {
    expect(validateBrowserToolDraft(draft)[field]).toBeTruthy();
  });
});

describe("displayBrowserToolUrl", () => {
  it("keeps the host and path but omits query strings and fragments", () => {
    expect(
      displayBrowserToolUrl(
        "https://example.com/tools/video/?token=secret#result",
      ),
    ).toBe("example.com/tools/video");
  });

  it("returns a safe label for malformed persisted data", () => {
    expect(displayBrowserToolUrl("not-a-url")).toBe("Invalid URL");
  });
});

describe("BrowserToolLauncher", () => {
  it("renders browser, profile mode, ordered tools, and accessible actions", () => {
    const html = renderToStaticMarkup(<BrowserToolLauncher {...props()} />);
    expect(html).toContain("Browser tools");
    expect(html).toContain("Google Chrome ready");
    expect(html).toContain('aria-pressed="true"');
    expect(html.indexOf("Google Flow")).toBeLessThan(html.indexOf("Kling"));
    expect(html).toContain('aria-label="Launch Google Flow"');
    expect(html).toContain('aria-label="Move tool up"');
    expect(html).toContain('aria-label="Edit Google Flow"');
    expect(html).toContain('aria-label="Remove Google Flow"');
    expect(html).toContain('aria-label="Open managed profile folder"');
    expect(html).toContain('aria-label="Reset managed profile"');
    expect(html).toContain("Open tools when workstation activates");
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain("source=afflow");
  });

  it("disables the auto-open control while a browser action is pending", () => {
    const html = renderToStaticMarkup(
      <BrowserToolLauncher {...props({ pendingAction: "launch-all" })} />,
    );

    expect(html).toMatch(
      /id="browser-tools-auto-open"[^>]*disabled|disabled[^>]*id="browser-tools-auto-open"/,
    );
  });

  it("renders empty and loading states", () => {
    const empty = renderToStaticMarkup(
      <BrowserToolLauncher {...props({ tools: [] })} />,
    );
    const loading = renderToStaticMarkup(
      <BrowserToolLauncher
        {...props({
          tools: [],
          loading: true,
          browser: { id: "chrome", name: "Google Chrome", status: "loading" },
          profile: { activity: "loading" },
        })}
      />,
    );
    expect(empty).toContain("No saved websites");
    expect(empty).toContain("Add website");
    expect(loading).toContain('aria-label="Loading browser tools"');
    expect(loading).toContain("Detecting installed browser");
    expect(loading).toContain("Checking profile");
  });

  it.each([
    ["unavailable", "Browser unavailable"],
    ["moved", "Browser executable moved"],
    ["error", "Browser detection failed"],
  ] as const)("renders the %s browser state", (status, expected) => {
    const html = renderToStaticMarkup(
      <BrowserToolLauncher
        {...props({
          browser: {
            id: "chrome",
            name: "Google Chrome",
            status,
            message: "Choose another executable.",
          },
          onRetry: vi.fn(),
          onOpenBrowserSettings: vi.fn(),
        })}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(expected);
    expect(html).toContain("Settings");
    expect(html).toContain("Retry");
    expect(html).toContain("disabled");
  });

  it.each([
    ["active", "Profile in use", "Close the managed browser before resetting"],
    [
      "unknown",
      "Profile activity unknown",
      "Cannot verify the profile is closed",
    ],
    ["error", "Profile could not be checked", "Profile reset unavailable"],
  ] as const)(
    "fails closed for a %s profile",
    (activity, expected, resetLabel) => {
      const html = renderToStaticMarkup(
        <BrowserToolLauncher
          {...props({
            profile: {
              activity,
              message: activity === "error" ? expected : undefined,
            },
          })}
        />,
      );
      expect(html).toContain(expected);
      expect(html).toContain(`aria-label="${resetLabel}"`);
      expect(html).toContain("disabled");
    },
  );

  it("disables reset before the managed profile has been created", () => {
    const html = renderToStaticMarkup(
      <BrowserToolLauncher
        {...props({ profile: { activity: "idle", exists: false } })}
      />,
    );

    expect(html).toContain('aria-label="Profile has not been created yet"');
    expect(html).toContain("disabled");
  });

  it("renders operation errors and success notices as live feedback", () => {
    const html = renderToStaticMarkup(
      <BrowserToolLauncher
        {...props({
          error: "The browser could not launch.",
          notice: "Browser window opened.",
        })}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('role="status"');
    expect(html).toContain("The browser could not launch.");
    expect(html).toContain("Browser window opened.");
  });
});
