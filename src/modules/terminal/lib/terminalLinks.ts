import { openExternalUrl } from "@/lib/external-link";
import type { ILink, ILinkProvider } from "@xterm/xterm";

export const WORKSTATION_FILE_ROOTS = [
  "agents",
  "products",
  "references",
  "research",
  "scripts",
  "images",
  "audio",
  "videos",
  "outputs",
] as const;

export type WorkstationFileReference = {
  relativePath: string;
  line?: number;
};

export type TerminalFileLinkTarget = WorkstationFileReference & {
  leafId: number;
};

export type TerminalFileLinkHandler = (
  target: TerminalFileLinkTarget,
) => void | Promise<void>;

export type WorkstationFileReferenceMatch = WorkstationFileReference & {
  start: number;
  end: number;
};

const MAX_REFERENCE_LENGTH = 512;
const MAX_LINE_NUMBER = 2_147_483_647;
const ROOT_SET = new Set<string>(WORKSTATION_FILE_ROOTS);
const ROOT_START = new RegExp(`(?:${WORKSTATION_FILE_ROOTS.join("|")})/`, "g");
const PATH_CHAR = /^[A-Za-z0-9._@+:/-]$/;
const SEGMENT = /^[A-Za-z0-9._@+-]+$/;
const LEFT_BOUNDARY = /^[\s([{"'`<>=,;]$/;
const RIGHT_BOUNDARY = /^[\s)\]}"'`,;!?<>]$/;

let terminalFileLinkHandler: TerminalFileLinkHandler | null = null;

export function createTerminalLinkHandler(focus: () => void) {
  return {
    activate: (_event: MouseEvent, uri: string) =>
      void openExternalUrl(uri, focus),
  };
}

export function setTerminalFileLinkHandler(
  handler: TerminalFileLinkHandler | null,
): void {
  terminalFileLinkHandler = handler;
}

export function parseWorkstationFileReference(
  token: string,
): WorkstationFileReference | null {
  if (!token || token.length > MAX_REFERENCE_LENGTH) return null;
  if (/[\x00-\x20\x7f\\]/.test(token)) return null;
  if (token.startsWith("/") || /^[A-Za-z]:/.test(token)) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(token)) return null;

  let relativePath = token;
  let line: number | undefined;
  const lineSuffix = /:([0-9]+)$/.exec(token);
  if (lineSuffix) {
    if (lineSuffix[1].length > 10) return null;
    line = Number(lineSuffix[1]);
    if (!Number.isSafeInteger(line) || line < 1 || line > MAX_LINE_NUMBER) {
      return null;
    }
    relativePath = token.slice(0, lineSuffix.index);
  }
  if (relativePath.includes(":")) return null;

  const segments = relativePath.split("/");
  if (segments.length < 2 || !ROOT_SET.has(segments[0])) return null;
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        !SEGMENT.test(segment),
    )
  ) {
    return null;
  }

  return line === undefined ? { relativePath } : { relativePath, line };
}

export function findWorkstationFileReferences(
  text: string,
): WorkstationFileReferenceMatch[] {
  const matches: WorkstationFileReferenceMatch[] = [];
  ROOT_START.lastIndex = 0;

  for (let root = ROOT_START.exec(text); root; root = ROOT_START.exec(text)) {
    const start = root.index;
    const before = start === 0 ? null : text[start - 1];
    if (before !== null && !LEFT_BOUNDARY.test(before)) continue;

    let end = ROOT_START.lastIndex;
    const limit = Math.min(text.length, start + MAX_REFERENCE_LENGTH + 1);
    while (end < limit && PATH_CHAR.test(text[end])) end += 1;
    if (end === start + MAX_REFERENCE_LENGTH + 1) continue;

    while (end > start && text[end - 1] === ".") end -= 1;
    const after = end === text.length ? null : text[end];
    if (after !== null && !RIGHT_BOUNDARY.test(after)) continue;

    const reference = parseWorkstationFileReference(text.slice(start, end));
    if (!reference) continue;
    matches.push({ ...reference, start, end });
    ROOT_START.lastIndex = end;
  }
  return matches;
}

export function activateTerminalFileReference(
  reference: WorkstationFileReference,
  resolveLeafId: () => number | null,
  resolveHandler: () => TerminalFileLinkHandler | null = () =>
    terminalFileLinkHandler,
): boolean {
  const leafId = resolveLeafId();
  const handler = resolveHandler();
  if (leafId === null || !handler) return false;
  void handler({ leafId, ...reference });
  return true;
}

export function createTerminalFileLinks(
  text: string,
  bufferLineNumber: number,
  activate: (reference: WorkstationFileReference) => void,
): ILink[] | undefined {
  const links = findWorkstationFileReferences(text).map((match) => {
    const reference: WorkstationFileReference =
      match.line === undefined
        ? { relativePath: match.relativePath }
        : { relativePath: match.relativePath, line: match.line };
    return {
      text: text.slice(match.start, match.end),
      range: {
        start: { x: match.start + 1, y: bufferLineNumber },
        end: { x: match.end, y: bufferLineNumber },
      },
      activate: () => activate(reference),
    } satisfies ILink;
  });
  return links.length > 0 ? links : undefined;
}

export function createTerminalFileLinkProvider(
  readLine: (bufferLineNumber: number) => string | null,
  resolveLeafId: () => number | null,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const text = readLine(bufferLineNumber);
      callback(
        text === null
          ? undefined
          : createTerminalFileLinks(text, bufferLineNumber, (reference) => {
              activateTerminalFileReference(reference, resolveLeafId);
            }),
      );
    },
  };
}
