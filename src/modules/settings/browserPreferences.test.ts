import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
}));
const emit = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get = storeMock.get;
    set = storeMock.set;
    save = storeMock.save;
  },
}));

vi.mock("@tauri-apps/api/event", () => ({ emit, listen: vi.fn() }));

import {
  DEFAULT_PREFERENCES,
  normalizeBrowserExecutableOverrides,
  normalizePreferredBrowserId,
  setBrowserExecutableOverride,
  setPreferredBrowserId,
} from "./store";

describe("browser preferences", () => {
  beforeEach(() => {
    storeMock.get.mockReset();
    storeMock.set.mockReset().mockResolvedValue(undefined);
    storeMock.save.mockReset().mockResolvedValue(undefined);
    emit.mockReset().mockResolvedValue(undefined);
  });

  it("defaults to detected Chrome with no executable overrides", () => {
    expect(DEFAULT_PREFERENCES.preferredBrowserId).toBe("chrome");
    expect(DEFAULT_PREFERENCES.browserExecutableOverrides).toEqual({});
  });

  it("accepts only supported preferred browser ids", () => {
    expect(normalizePreferredBrowserId("edge")).toBe("edge");
    expect(normalizePreferredBrowserId("chrome")).toBe("chrome");
    expect(normalizePreferredBrowserId("firefox")).toBe("chrome");
    expect(normalizePreferredBrowserId(null)).toBe("chrome");
  });

  it("keeps canonical per-browser overrides and ignores unknown keys", () => {
    expect(
      normalizeBrowserExecutableOverrides({
        chrome: "C:/Portable/Chrome/chrome.exe",
        edge: " C:\\Portable\\Edge\\msedge.exe ",
        firefox: "C:/Portable/Firefox/firefox.exe",
      }),
    ).toEqual({
      chrome: "C:/Portable/Chrome/chrome.exe",
      edge: "C:/Portable/Edge/msedge.exe",
    });
  });

  it("preserves a canonical moved path for native revalidation", () => {
    expect(
      normalizeBrowserExecutableOverrides({
        chrome: "D:/Moved/Chrome/chrome.exe",
      }),
    ).toEqual({ chrome: "D:/Moved/Chrome/chrome.exe" });
  });

  it("drops malformed, relative, traversing, and control-character paths", () => {
    expect(normalizeBrowserExecutableOverrides(null)).toEqual({});
    expect(normalizeBrowserExecutableOverrides([])).toEqual({});
    expect(
      normalizeBrowserExecutableOverrides({
        chrome: "../chrome.exe",
        edge: "C:/Portable/../Edge/msedge.exe",
      }),
    ).toEqual({});
    expect(
      normalizeBrowserExecutableOverrides({ chrome: "C:/Chrome/\u0000.exe" }),
    ).toEqual({});
  });

  it("persists and broadcasts the preferred browser", async () => {
    await setPreferredBrowserId("edge");

    expect(storeMock.set).toHaveBeenCalledExactlyOnceWith(
      "preferredBrowserId",
      "edge",
    );
    expect(storeMock.save).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledExactlyOnceWith("terax://prefs-changed", {
      key: "preferredBrowserId",
      value: "edge",
    });
  });

  it("merges, canonicalizes, and clears one override without losing the other", async () => {
    storeMock.get
      .mockResolvedValueOnce({ edge: "C:/Edge/msedge.exe" })
      .mockResolvedValueOnce({
        chrome: "D:/Portable/Chrome/chrome.exe",
        edge: "C:/Edge/msedge.exe",
      });

    await setBrowserExecutableOverride(
      "chrome",
      "D:\\Portable\\Chrome\\chrome.exe",
    );
    await setBrowserExecutableOverride("chrome", null);

    expect(storeMock.set).toHaveBeenNthCalledWith(
      1,
      "browserExecutableOverrides",
      {
        chrome: "D:/Portable/Chrome/chrome.exe",
        edge: "C:/Edge/msedge.exe",
      },
    );
    expect(storeMock.set).toHaveBeenNthCalledWith(
      2,
      "browserExecutableOverrides",
      { edge: "C:/Edge/msedge.exe" },
    );
  });

  it("refuses to persist a non-absolute override", async () => {
    storeMock.get.mockResolvedValue({});

    await expect(
      setBrowserExecutableOverride("chrome", "portable/chrome.exe"),
    ).rejects.toThrow("Invalid browser executable path.");
    expect(storeMock.set).not.toHaveBeenCalled();
  });
});
