import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  detectBrowsers,
  getBrowserProfileStatus,
  launchBrowser,
  openBrowserProfileFolder,
  resetBrowserProfile,
  validateBrowserExecutable,
} from "@/modules/browser-tools/lib/native";

describe("browser native bridge", () => {
  beforeEach(() => invoke.mockReset());

  it("uses the native detection command without arguments", async () => {
    invoke.mockResolvedValue([]);

    await expect(detectBrowsers()).resolves.toEqual([]);
    expect(invoke).toHaveBeenCalledWith("browser_detect");
  });

  it("wraps executable validation in the request DTO", async () => {
    invoke.mockResolvedValue({
      browserId: "chrome",
      path: "C:/Chrome/chrome.exe",
    });

    await validateBrowserExecutable("chrome", "C:/Chrome/chrome.exe");

    expect(invoke).toHaveBeenCalledWith("browser_validate_executable", {
      request: { browserId: "chrome", path: "C:/Chrome/chrome.exe" },
    });
  });

  it("preserves the profile status request shape", async () => {
    invoke.mockResolvedValue({});
    const request = { browserId: "edge" as const, profileId: "bp-one" };

    await getBrowserProfileStatus(request);

    expect(invoke).toHaveBeenCalledWith("browser_profile_status", { request });
  });

  it("preserves ordered URLs in a structured launch request", async () => {
    invoke.mockResolvedValue({});
    const request = {
      browserId: "chrome" as const,
      executablePath: null,
      profileId: "bp-one",
      urls: ["https://one.example/", "https://two.example/"],
    };

    await launchBrowser(request);

    expect(invoke).toHaveBeenCalledWith("browser_launch", { request });
  });

  it("opens only a native-derived profile request", async () => {
    invoke.mockResolvedValue({});
    const request = { browserId: "chrome" as const, profileId: "shared-v1" };

    await openBrowserProfileFolder(request);

    expect(invoke).toHaveBeenCalledWith("browser_profile_open_folder", {
      request,
    });
  });

  it("requires the typed confirmed reset request", async () => {
    invoke.mockResolvedValue({});
    const request = {
      browserId: "edge" as const,
      profileId: "bp-two",
      confirmed: true as const,
    };

    await resetBrowserProfile(request);

    expect(invoke).toHaveBeenCalledWith("browser_profile_reset", { request });
  });
});
