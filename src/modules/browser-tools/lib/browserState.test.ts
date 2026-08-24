import {
  activeBrowserProfileId,
  browserProfileIdForWorkstation,
  browserToolUrlBytes,
  createDefaultBrowserTools,
  createDefaultWorkstationBrowserState,
  DEFAULT_BROWSER_TOOLS,
  hasCanonicalWorkstationBrowserState,
  isIsolatedBrowserProfileId,
  isManagedBrowserId,
  MAX_BROWSER_TOOLS,
  MAX_BROWSER_URL_TOTAL_BYTES,
  newBrowserProfileId,
  newBrowserToolId,
  normalizeBrowserTools,
  normalizeWorkstationBrowserState,
  SHARED_BROWSER_PROFILE_ID,
  validateBrowserToolInput,
  validateBrowserUrl,
} from "@/modules/browser-tools/lib/browserState";
import { describe, expect, it } from "vitest";

describe("browser state", () => {
  it("defines fresh initial tools in product order", () => {
    const first = createDefaultBrowserTools();
    const second = createDefaultBrowserTools();

    expect(first.map((tool) => tool.name)).toEqual([
      "Google Flow",
      "Kling",
      "Grok",
      "TikTok",
      "Shopee",
      "Facebook",
    ]);
    expect(first).toEqual(DEFAULT_BROWSER_TOOLS);
    expect(first).not.toBe(second);
    expect(first.every((tool, index) => tool !== second[index])).toBe(true);
  });

  it("creates distinct native-safe opaque ids", () => {
    const profileIds = [newBrowserProfileId(), newBrowserProfileId()];
    const toolIds = [newBrowserToolId(), newBrowserToolId()];

    expect(new Set(profileIds).size).toBe(2);
    expect(new Set(toolIds).size).toBe(2);
    expect(profileIds.every(isIsolatedBrowserProfileId)).toBe(true);
    expect(toolIds.every(isManagedBrowserId)).toBe(true);
  });

  it("derives stable and distinct migration ids from workstation identity", () => {
    const first = browserProfileIdForWorkstation("sp-existing");

    expect(browserProfileIdForWorkstation("sp-existing")).toBe(first);
    expect(browserProfileIdForWorkstation("sp-other")).not.toBe(first);
    expect(isIsolatedBrowserProfileId(first)).toBe(true);
  });

  it("rejects unsafe and reserved managed ids", () => {
    expect(isManagedBrowserId("bp-valid_1")).toBe(true);
    for (const value of [
      "",
      ".",
      "../escape",
      "has space",
      "C:drive",
      "unicode-\u2603",
      "CON",
      "lpt9",
      "a".repeat(65),
    ]) {
      expect(isManagedBrowserId(value)).toBe(false);
    }
    expect(isIsolatedBrowserProfileId(SHARED_BROWSER_PROFILE_ID)).toBe(false);
  });

  it("normalizes absolute HTTP and HTTPS URLs without query or fragment data", () => {
    expect(
      validateBrowserUrl("  https://example.com/path?q=secret#result  "),
    ).toEqual({
      ok: true,
      url: "https://example.com/path",
    });
    expect(validateBrowserUrl("http://localhost:3000")).toEqual({
      ok: true,
      url: "http://localhost:3000/",
    });
  });

  it("rejects malformed, credentialed, unsupported, and excessive URLs", () => {
    for (const value of [
      "",
      "--incognito",
      "example.com",
      "file:///tmp/tool",
      "https://user:secret@example.com/",
      "https://example.com/\nnext",
      `https://example.com/${"a".repeat(2048)}`,
    ]) {
      expect(validateBrowserUrl(value).ok).toBe(false);
    }
  });

  it("trims tool fields and rejects invalid names", () => {
    expect(
      validateBrowserToolInput({
        name: "  Local Tool  ",
        url: "http://localhost:5173",
      }),
    ).toEqual({
      ok: true,
      tool: { name: "Local Tool", url: "http://localhost:5173/" },
    });
    expect(
      validateBrowserToolInput({ name: " ", url: "https://x.com" }).ok,
    ).toBe(false);
    expect(
      validateBrowserToolInput({ name: "Bad\nName", url: "https://x.com" }).ok,
    ).toBe(false);
  });

  it("normalizes ordered tools, removing invalid and duplicate entries", () => {
    const candidates = [
      { id: "first", name: " First ", url: "https://first.example" },
      { id: "first", name: "Duplicate", url: "https://duplicate.example" },
      { id: "bad.id", name: "Bad", url: "https://bad.example" },
      { id: "second", name: "Second", url: "http://localhost:3000" },
    ];

    expect(normalizeBrowserTools(candidates)).toEqual([
      { id: "first", name: "First", url: "https://first.example/" },
      { id: "second", name: "Second", url: "http://localhost:3000/" },
    ]);
  });

  it("caps normalized tools and total launch input", () => {
    const candidates = Array.from(
      { length: MAX_BROWSER_TOOLS + 3 },
      (_, index) => ({
        id: `tool-${index}`,
        name: `Tool ${index}`,
        url: `https://example.com/${index}`,
      }),
    );
    const normalized = normalizeBrowserTools(candidates);

    expect(normalized).toHaveLength(MAX_BROWSER_TOOLS);
    expect(browserToolUrlBytes(normalized)).toBeLessThanOrEqual(
      MAX_BROWSER_URL_TOTAL_BYTES,
    );
  });

  it("defaults malformed browser state but preserves an intentional empty list", () => {
    const malformed = normalizeWorkstationBrowserState({
      profileMode: "unknown",
      profileId: SHARED_BROWSER_PROFILE_ID,
      tools: "invalid",
      openOnWorkstationLaunch: "yes",
    });
    const empty = normalizeWorkstationBrowserState({
      profileMode: "shared",
      profileId: "bp-existing",
      tools: [],
      openOnWorkstationLaunch: true,
    });

    expect(malformed).toMatchObject({
      profileMode: "workstation",
      tools: createDefaultBrowserTools(),
      openOnWorkstationLaunch: false,
    });
    expect(isIsolatedBrowserProfileId(malformed.profileId)).toBe(true);
    expect(empty).toEqual({
      profileMode: "shared",
      profileId: "bp-existing",
      tools: [],
      openOnWorkstationLaunch: true,
    });
  });

  it("resolves shared mode without overwriting the isolated id", () => {
    const browser = createDefaultWorkstationBrowserState("bp-stable");
    const shared = { ...browser, profileMode: "shared" as const };

    expect(activeBrowserProfileId(browser)).toBe("bp-stable");
    expect(activeBrowserProfileId(shared)).toBe(SHARED_BROWSER_PROFILE_ID);
    expect(shared.profileId).toBe("bp-stable");
    expect(hasCanonicalWorkstationBrowserState(shared, shared)).toBe(true);
    expect(
      hasCanonicalWorkstationBrowserState(
        { ...shared, tools: [{ ...shared.tools[0], name: " changed " }] },
        shared,
      ),
    ).toBe(false);
  });
});
