import { describe, expect, it } from "vitest";
import { browserToolsNativeDemand } from "@/modules/browser-tools/lib/useBrowserTools";

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
