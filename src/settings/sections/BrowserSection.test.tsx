import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  browserPresentation,
  BrowserSettingsView,
  type BrowserSettingsViewProps,
} from "./BrowserSection";

function props(
  overrides: Partial<BrowserSettingsViewProps> = {},
): BrowserSettingsViewProps {
  return {
    preferredBrowserId: "chrome",
    detections: [
      {
        id: "chrome",
        name: "Google Chrome",
        available: true,
        resolvedPath: "C:/Program Files/Google/Chrome/chrome.exe",
      },
      {
        id: "edge",
        name: "Microsoft Edge",
        available: false,
        resolvedPath: null,
      },
    ],
    overrideChecks: {},
    loading: false,
    detectionError: null,
    actionErrors: {},
    busyBrowserId: null,
    onPreferredBrowserChange: vi.fn(),
    onChooseExecutable: vi.fn(),
    onClearOverride: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
}

function html(overrides: Partial<BrowserSettingsViewProps> = {}) {
  return renderToStaticMarkup(<BrowserSettingsView {...props(overrides)} />);
}

describe("BrowserSettingsView", () => {
  it("shows fixed browser choices and native detection status", () => {
    const markup = html();

    expect(markup).toContain("Preferred browser");
    expect(markup).toContain("Chrome");
    expect(markup).toContain("Edge");
    expect(markup).toContain("Detected");
    expect(markup).toContain("C:/Program Files/Google/Chrome/chrome.exe");
    expect(markup).toContain("Not detected");
    expect(markup).toContain("Choose .exe");
  });

  it("renders loading and detection failure states with retry", () => {
    const loading = html({ detections: null, loading: true });
    const failed = html({
      detections: null,
      detectionError: "Registry lookup failed.",
    });

    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("Checking browsers...");
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Browser detection failed");
    expect(failed).toContain("Registry lookup failed.");
    expect(failed).toContain("Retry");
  });

  it("shows validated overrides and a clear action", () => {
    const markup = html({
      overrideChecks: {
        chrome: {
          state: "valid",
          path: "D:/Portable/Chrome/chrome.exe",
        },
      },
    });

    expect(markup).toContain("Custom executable");
    expect(markup).toContain("D:/Portable/Chrome/chrome.exe");
    expect(markup).toContain("Change");
    expect(markup).toContain(
      'aria-label="Clear Google Chrome executable override"',
    );
  });

  it("keeps a moved override visible and explains how to recover", () => {
    const markup = html({
      overrideChecks: {
        edge: {
          state: "invalid",
          path: "D:/Moved/Edge/msedge.exe",
          error: "The file does not exist.",
        },
      },
    });

    expect(markup).toContain("Custom path unavailable");
    expect(markup).toContain("D:/Moved/Edge/msedge.exe");
    expect(markup).toContain("was moved or is no longer valid");
    expect(markup).toContain("The file does not exist.");
    expect(markup).toContain(
      'aria-label="Clear Microsoft Edge executable override"',
    );
  });

  it("does not expose arbitrary arguments or normal-profile selection", () => {
    const markup = html();

    expect(markup).not.toContain("Arguments");
    expect(markup).not.toContain("--user-data-dir");
    expect(markup).not.toContain("Normal profile");
  });
});

describe("browserPresentation", () => {
  it("gives a saved override precedence over automatic detection", () => {
    expect(
      browserPresentation(
        {
          id: "chrome",
          name: "Google Chrome",
          available: true,
          resolvedPath: "C:/Installed/chrome.exe",
        },
        { state: "valid", path: "D:/Portable/chrome.exe" },
        false,
      ),
    ).toMatchObject({
      kind: "available",
      label: "Custom executable",
      path: "D:/Portable/chrome.exe",
    });
  });

  it("distinguishes validating, invalid, detected, and missing states", () => {
    expect(
      browserPresentation(
        null,
        { state: "validating", path: "C:/Chrome/chrome.exe" },
        true,
      ).kind,
    ).toBe("loading");
    expect(
      browserPresentation(
        null,
        {
          state: "invalid",
          path: "C:/Chrome/chrome.exe",
          error: "Missing.",
        },
        false,
      ).kind,
    ).toBe("error");
    expect(
      browserPresentation(
        {
          id: "edge",
          name: "Microsoft Edge",
          available: true,
          resolvedPath: "C:/Edge/msedge.exe",
        },
        null,
        false,
      ).label,
    ).toBe("Detected");
    expect(browserPresentation(null, null, false).label).toBe("Not detected");
  });
});
