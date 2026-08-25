import {
  browserProfileResetFeedback,
  browserToolsNativeDemand,
} from "@/modules/browser-tools/lib/useBrowserTools";
import { describe, expect, it } from "vitest";

describe("browserToolsNativeDemand", () => {
  it("does no native work until both stores are hydrated", () => {
    expect(
      browserToolsNativeDemand({
        preferencesHydrated: false,
        spacesLoading: false,
        menuOpen: true,
        autoOpenEnabled: true,
      }),
    ).toBe(false);
    expect(
      browserToolsNativeDemand({
        preferencesHydrated: true,
        spacesLoading: true,
        menuOpen: true,
        autoOpenEnabled: true,
      }),
    ).toBe(false);
  });

  it("runs native work only for visible or auto-open browser tools", () => {
    expect(
      browserToolsNativeDemand({
        preferencesHydrated: true,
        spacesLoading: false,
        menuOpen: false,
        autoOpenEnabled: false,
      }),
    ).toBe(false);
    expect(
      browserToolsNativeDemand({
        preferencesHydrated: true,
        spacesLoading: false,
        menuOpen: true,
        autoOpenEnabled: false,
      }),
    ).toBe(true);
    expect(
      browserToolsNativeDemand({
        preferencesHydrated: true,
        spacesLoading: false,
        menuOpen: false,
        autoOpenEnabled: true,
      }),
    ).toBe(true);
  });
});

describe("browserProfileResetFeedback", () => {
  it("reports a completed reset with no cleanup warning", () => {
    expect(browserProfileResetFeedback(false)).toEqual({
      notice: "Managed browser profile reset.",
      warning: null,
    });
  });

  it("keeps a successful reset distinct from pending old-data cleanup", () => {
    const feedback = browserProfileResetFeedback(true);
    expect(feedback.notice).toBe("Managed browser profile reset.");
    expect(feedback.warning).toContain("new profile is ready");
    expect(feedback.warning).toContain("before resetting this profile again");
  });
});
