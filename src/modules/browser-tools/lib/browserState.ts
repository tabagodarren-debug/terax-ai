import type {
  BrowserProfileMode,
  BrowserTool,
  BrowserToolInput,
  WorkstationBrowserState,
} from "@/modules/browser-tools/lib/types";

export const SHARED_BROWSER_PROFILE_ID = "shared-v1";
export const MAX_BROWSER_TOOLS = 16;
export const MAX_BROWSER_URL_BYTES = 2048;
export const MAX_BROWSER_URL_TOTAL_BYTES = 16_384;
export const MAX_BROWSER_TOOL_NAME_LENGTH = 80;

const MANAGED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const RESERVED_PATH_COMPONENT_PATTERN =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const textEncoder = new TextEncoder();

export const DEFAULT_BROWSER_TOOLS = [
  {
    id: "google-flow",
    name: "Google Flow",
    url: "https://labs.google/fx/tools/flow",
  },
  { id: "kling", name: "Kling", url: "https://klingai.com/" },
  { id: "grok", name: "Grok", url: "https://grok.com/" },
  { id: "tiktok", name: "TikTok", url: "https://www.tiktok.com/" },
  { id: "shopee", name: "Shopee", url: "https://shopee.ph/" },
  {
    id: "facebook",
    name: "Facebook",
    url: "https://www.facebook.com/",
  },
] as const satisfies readonly BrowserTool[];

export type BrowserUrlValidation =
  | { ok: true; url: string }
  | { ok: false; error: string };

export type BrowserToolValidation =
  | { ok: true; tool: BrowserToolInput }
  | { ok: false; error: string };

function utf8Length(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function randomOpaqueId(prefix: string): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${prefix}-${value}`;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of textEncoder.encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function newBrowserProfileId(): string {
  return randomOpaqueId("bp");
}

export function newBrowserToolId(): string {
  return randomOpaqueId("bt");
}

export function browserProfileIdForWorkstation(workstationId: string): string {
  return `bp-${fnv1a64(`afflow:${workstationId}:profile`)}${fnv1a64(
    `afflow:${workstationId}:isolation`,
  )}`;
}

export function isManagedBrowserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    MANAGED_ID_PATTERN.test(value) &&
    !RESERVED_PATH_COMPONENT_PATTERN.test(value)
  );
}

export function isIsolatedBrowserProfileId(value: unknown): value is string {
  return isManagedBrowserId(value) && value !== SHARED_BROWSER_PROFILE_ID;
}

export function validateBrowserUrl(value: unknown): BrowserUrlValidation {
  if (typeof value !== "string") {
    return { ok: false, error: "Website URL is required." };
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    return { ok: false, error: "Website URL contains unsupported characters." };
  }
  const input = value.trim();
  if (!input) return { ok: false, error: "Website URL is required." };
  if (utf8Length(input) > MAX_BROWSER_URL_BYTES) {
    return { ok: false, error: "Website URL is too long." };
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, error: "Enter a valid absolute website URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Website URL must use HTTP or HTTPS." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Website URL cannot contain credentials." };
  }
  parsed.search = "";
  parsed.hash = "";
  const normalized = parsed.toString();
  if (utf8Length(normalized) > MAX_BROWSER_URL_BYTES) {
    return { ok: false, error: "Website URL is too long." };
  }
  return { ok: true, url: normalized };
}

export function validateBrowserToolInput(
  value: unknown,
): BrowserToolValidation {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Website tool is required." };
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.name !== "string") {
    return { ok: false, error: "Website name is required." };
  }
  const name = raw.name.trim();
  if (!name) return { ok: false, error: "Website name is required." };
  if (
    name.length > MAX_BROWSER_TOOL_NAME_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(name)
  ) {
    return { ok: false, error: "Website name is invalid." };
  }
  const url = validateBrowserUrl(raw.url);
  if (!url.ok) return url;
  return { ok: true, tool: { name, url: url.url } };
}

export function normalizeBrowserTool(value: unknown): BrowserTool | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!isManagedBrowserId(raw.id)) return null;
  const result = validateBrowserToolInput(raw);
  return result.ok ? { id: raw.id, ...result.tool } : null;
}

export function browserToolUrlBytes(tools: readonly BrowserTool[]): number {
  return tools.reduce((total, tool) => total + utf8Length(tool.url), 0);
}

export function normalizeBrowserTools(value: unknown): BrowserTool[] {
  if (!Array.isArray(value)) return [];
  const tools: BrowserTool[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const candidate of value) {
    const tool = normalizeBrowserTool(candidate);
    if (!tool || seen.has(tool.id)) continue;
    const nextBytes = totalBytes + utf8Length(tool.url);
    if (nextBytes > MAX_BROWSER_URL_TOTAL_BYTES) continue;
    seen.add(tool.id);
    tools.push(tool);
    totalBytes = nextBytes;
    if (tools.length === MAX_BROWSER_TOOLS) break;
  }
  return tools;
}

export function createDefaultBrowserTools(): BrowserTool[] {
  return DEFAULT_BROWSER_TOOLS.map((tool) => ({ ...tool }));
}

export function createDefaultWorkstationBrowserState(
  profileId = newBrowserProfileId(),
): WorkstationBrowserState {
  if (!isIsolatedBrowserProfileId(profileId)) {
    throw new Error("Isolated browser profile id is invalid.");
  }
  return {
    profileMode: "workstation",
    profileId,
    tools: createDefaultBrowserTools(),
    openOnWorkstationLaunch: false,
  };
}

export function normalizeWorkstationBrowserState(
  value: unknown,
  fallbackProfileId = newBrowserProfileId(),
): WorkstationBrowserState {
  if (!isIsolatedBrowserProfileId(fallbackProfileId)) {
    throw new Error("Fallback browser profile id is invalid.");
  }
  if (!value || typeof value !== "object") {
    return createDefaultWorkstationBrowserState(fallbackProfileId);
  }
  const raw = value as Record<string, unknown>;
  const profileMode: BrowserProfileMode =
    raw.profileMode === "shared" ? "shared" : "workstation";
  const profileId = isIsolatedBrowserProfileId(raw.profileId)
    ? raw.profileId
    : fallbackProfileId;
  return {
    profileMode,
    profileId,
    tools: Array.isArray(raw.tools)
      ? normalizeBrowserTools(raw.tools)
      : createDefaultBrowserTools(),
    openOnWorkstationLaunch:
      typeof raw.openOnWorkstationLaunch === "boolean"
        ? raw.openOnWorkstationLaunch
        : false,
  };
}

export function hasCanonicalWorkstationBrowserState(
  value: unknown,
  normalized: WorkstationBrowserState,
): boolean {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  const rawTools = raw.tools;
  if (
    raw.profileMode !== normalized.profileMode ||
    raw.profileId !== normalized.profileId ||
    raw.openOnWorkstationLaunch !== normalized.openOnWorkstationLaunch ||
    !Array.isArray(rawTools) ||
    rawTools.length !== normalized.tools.length
  ) {
    return false;
  }
  return normalized.tools.every((tool, index) => {
    const candidate = rawTools[index];
    if (!candidate || typeof candidate !== "object") return false;
    const record = candidate as Record<string, unknown>;
    return (
      record.id === tool.id &&
      record.name === tool.name &&
      record.url === tool.url
    );
  });
}

export function activeBrowserProfileId(
  browser: Pick<WorkstationBrowserState, "profileMode" | "profileId">,
): string {
  return browser.profileMode === "shared"
    ? SHARED_BROWSER_PROFILE_ID
    : browser.profileId;
}
