import type { BrowserId } from "@/modules/browser-tools/lib/types";
import { invoke } from "@tauri-apps/api/core";

export type BrowserDetection = {
  id: BrowserId;
  name: string;
  available: boolean;
  resolvedPath: string | null;
};

export type BrowserExecutable = {
  browserId: BrowserId;
  path: string;
};

export type BrowserProfileActivity = "active" | "idle" | "unknown";

export type BrowserProfileRequest = {
  browserId: BrowserId;
  profileId: string;
};

export type BrowserProfileStatus = BrowserProfileRequest & {
  profilePath: string;
  exists: boolean;
  activity: BrowserProfileActivity;
};

export type BrowserProfileLocation = BrowserProfileRequest & {
  profilePath: string;
};

export type BrowserLaunchRequest = BrowserProfileRequest & {
  executablePath: string | null;
  urls: string[];
};

export type BrowserLaunchResult = BrowserProfileLocation & {
  executablePath: string;
  pid: number;
  launchedUrlCount: number;
};

export type BrowserProfileResetRequest = BrowserProfileRequest & {
  confirmed: true;
};

export type BrowserProfileResetResult = BrowserProfileLocation & {
  reset: boolean;
  cleanupPending: boolean;
};

export function detectBrowsers(): Promise<BrowserDetection[]> {
  return invoke<BrowserDetection[]>("browser_detect");
}

export function validateBrowserExecutable(
  browserId: BrowserId,
  path: string,
): Promise<BrowserExecutable> {
  return invoke<BrowserExecutable>("browser_validate_executable", {
    request: { browserId, path },
  });
}

export function getBrowserProfileStatus(
  request: BrowserProfileRequest,
): Promise<BrowserProfileStatus> {
  return invoke<BrowserProfileStatus>("browser_profile_status", { request });
}

export function launchBrowser(
  request: BrowserLaunchRequest,
): Promise<BrowserLaunchResult> {
  return invoke<BrowserLaunchResult>("browser_launch", { request });
}

export function openBrowserProfileFolder(
  request: BrowserProfileRequest,
): Promise<BrowserProfileLocation> {
  return invoke<BrowserProfileLocation>("browser_profile_open_folder", {
    request,
  });
}

export function resetBrowserProfile(
  request: BrowserProfileResetRequest,
): Promise<BrowserProfileResetResult> {
  return invoke<BrowserProfileResetResult>("browser_profile_reset", {
    request,
  });
}
