import {
  isLeaf,
  type PaneNode,
  type SplitDir,
} from "@/modules/terminal/lib/panes";
import type {
  EditorTab,
  MarkdownTab,
  PreviewTab,
  Tab,
  TerminalTab,
} from "@/modules/tabs/lib/useTabs";

export type SerializedNode =
  | { kind: "leaf"; cwd?: WorkstationPathRef; active?: boolean }
  | { kind: "split"; dir: SplitDir; children: SerializedNode[] };

export type WorkstationPathRef = {
  kind: "workstation-relative";
  path: string;
};

export type SerializedTab =
  | {
      kind: "terminal";
      tree: SerializedNode;
      blocks?: boolean;
      customTitle?: string;
    }
  | { kind: "editor"; path: WorkstationPathRef }
  | { kind: "preview"; url: string }
  | { kind: "markdown"; path: WorkstationPathRef };

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function titleFromUrl(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url || "preview";
  }
}

function normalizedSegments(path: string): string[] | null {
  if (path.includes("\0")) return null;
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments.some((segment) => segment === "." || segment === "..")
    ? null
    : segments;
}

function isCaseInsensitiveRoot(root: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(root) || /^[\\/]{2}/.test(root);
}

function absolutePathKind(path: string): string | null {
  const normalized = path.trim().replace(/\\/g, "/");
  const drive = normalized.match(/^([A-Za-z]):\//);
  if (drive) return `drive:${drive[1].toLowerCase()}`;
  if (normalized.startsWith("//")) return "unc";
  return normalized.startsWith("/") ? "unix" : null;
}

export function toWorkstationPathRef(
  path: string,
  root: string | null,
): WorkstationPathRef | null {
  if (!root || !path) return null;
  const rootKind = absolutePathKind(root);
  if (!rootKind || absolutePathKind(path) !== rootKind) return null;
  const rootSegments = normalizedSegments(root);
  const pathSegments = normalizedSegments(path);
  if (
    !rootSegments ||
    !pathSegments ||
    pathSegments.length < rootSegments.length
  ) {
    return null;
  }
  const insensitive = isCaseInsensitiveRoot(root);
  for (let index = 0; index < rootSegments.length; index += 1) {
    const expected = rootSegments[index];
    const actual = pathSegments[index];
    if (
      insensitive
        ? expected.toLowerCase() !== actual.toLowerCase()
        : expected !== actual
    ) {
      return null;
    }
  }
  return {
    kind: "workstation-relative",
    path: pathSegments.slice(rootSegments.length).join("/"),
  };
}

function normalizePathRef(value: unknown): WorkstationPathRef | null {
  if (!value || typeof value !== "object") return null;
  const ref = value as Record<string, unknown>;
  if (ref.kind !== "workstation-relative" || typeof ref.path !== "string") {
    return null;
  }
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(ref.path)) return null;
  const segments = normalizedSegments(ref.path);
  if (!segments) return null;
  return { kind: "workstation-relative", path: segments.join("/") };
}

export function resolveWorkstationPathRef(
  value: unknown,
  root: string | null,
): string | null {
  if (!root) return null;
  const ref = normalizePathRef(value);
  if (!ref) return null;
  const rawRoot = root.trim().replace(/\\/g, "/");
  const normalizedRoot =
    rawRoot === "/" || /^[A-Za-z]:\/$/.test(rawRoot)
      ? rawRoot
      : rawRoot.replace(/\/+$/, "");
  if (!normalizedRoot) return null;
  if (!ref.path) return normalizedRoot;
  return normalizedRoot.endsWith("/")
    ? `${normalizedRoot}${ref.path}`
    : `${normalizedRoot}/${ref.path}`;
}

function serializeNode(
  node: PaneNode,
  activeLeafId: number,
  root: string | null,
): SerializedNode {
  if (isLeaf(node)) {
    const cwd = node.cwd ? toWorkstationPathRef(node.cwd, root) : null;
    return {
      kind: "leaf",
      ...(cwd && { cwd }),
      ...(node.id === activeLeafId && { active: true }),
    };
  }
  return {
    kind: "split",
    dir: node.dir,
    children: node.children.map((c) => serializeNode(c, activeLeafId, root)),
  };
}

export function isSerializableTab(tab: Tab): boolean {
  switch (tab.kind) {
    case "terminal":
      return !tab.private;
    case "editor":
    case "preview":
    case "markdown":
      return true;
    default:
      return false;
  }
}

function serializeTab(tab: Tab, root: string | null): SerializedTab | null {
  if (!isSerializableTab(tab)) return null;
  switch (tab.kind) {
    case "terminal":
      return {
        kind: "terminal",
        tree: serializeNode(tab.paneTree, tab.activeLeafId, root),
        ...(tab.blocks && { blocks: true }),
        ...(tab.customTitle !== undefined && { customTitle: tab.customTitle }),
      };
    case "editor": {
      const editorPath = toWorkstationPathRef(tab.path, root);
      return editorPath?.path ? { kind: "editor", path: editorPath } : null;
    }
    case "preview":
      return { kind: "preview", url: tab.url };
    case "markdown": {
      const markdownPath = toWorkstationPathRef(tab.path, root);
      return markdownPath?.path
        ? { kind: "markdown", path: markdownPath }
        : null;
    }
    default:
      return null;
  }
}

export function serializeTabs(
  tabs: Tab[],
  root: string | null,
): SerializedTab[] {
  const out: SerializedTab[] = [];
  for (const tab of tabs) {
    const s = serializeTab(tab, root);
    if (s) out.push(s);
  }
  return out;
}

type MigratedValue<T> = {
  value: T | null;
  changed: boolean;
};

function migratePathRef(
  value: unknown,
  root: string | null,
): MigratedValue<WorkstationPathRef> {
  if (typeof value === "string") {
    return { value: toWorkstationPathRef(value, root), changed: true };
  }
  const normalized = normalizePathRef(value);
  if (!normalized) return { value: null, changed: value !== undefined };
  const raw = value as Record<string, unknown>;
  return {
    value: normalized,
    changed:
      raw.kind !== normalized.kind ||
      raw.path !== normalized.path ||
      Object.keys(raw).length !== 2,
  };
}

function migrateNode(
  value: unknown,
  root: string | null,
): MigratedValue<SerializedNode> {
  if (!value || typeof value !== "object") {
    return { value: null, changed: true };
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind === "leaf") {
    const cwd = migratePathRef(raw.cwd, root);
    return {
      value: {
        kind: "leaf",
        ...(cwd.value && { cwd: cwd.value }),
        ...(raw.active === true && { active: true }),
      },
      changed:
        cwd.changed ||
        (raw.active !== undefined && raw.active !== true) ||
        Object.keys(raw).some(
          (key) => key !== "kind" && key !== "cwd" && key !== "active",
        ),
    };
  }
  if (
    raw.kind !== "split" ||
    (raw.dir !== "row" && raw.dir !== "col") ||
    !Array.isArray(raw.children)
  ) {
    return { value: null, changed: true };
  }
  let changed = false;
  const children: SerializedNode[] = [];
  for (const child of raw.children) {
    const migrated = migrateNode(child, root);
    changed ||= migrated.changed;
    if (migrated.value) children.push(migrated.value);
    else changed = true;
  }
  if (children.length === 0) return { value: null, changed: true };
  return {
    value: { kind: "split", dir: raw.dir, children },
    changed:
      changed ||
      Object.keys(raw).some(
        (key) => key !== "kind" && key !== "dir" && key !== "children",
      ),
  };
}

function migrateSerializedTab(
  value: unknown,
  root: string | null,
): MigratedValue<SerializedTab> {
  if (!value || typeof value !== "object") {
    return { value: null, changed: true };
  }
  const raw = value as Record<string, unknown>;
  switch (raw.kind) {
    case "terminal": {
      const tree = migrateNode(raw.tree, root);
      if (!tree.value) return { value: null, changed: true };
      return {
        value: {
          kind: "terminal",
          tree: tree.value,
          ...(raw.blocks === true && { blocks: true }),
          ...(typeof raw.customTitle === "string" && {
            customTitle: raw.customTitle,
          }),
        },
        changed:
          tree.changed ||
          (raw.blocks !== undefined && raw.blocks !== true) ||
          (raw.customTitle !== undefined &&
            typeof raw.customTitle !== "string") ||
          Object.keys(raw).some(
            (key) =>
              key !== "kind" &&
              key !== "tree" &&
              key !== "blocks" &&
              key !== "customTitle",
          ),
      };
    }
    case "editor":
    case "markdown": {
      const path = migratePathRef(raw.path, root);
      return {
        value: path.value?.path ? { kind: raw.kind, path: path.value } : null,
        changed:
          path.changed ||
          Object.keys(raw).some((key) => key !== "kind" && key !== "path"),
      };
    }
    case "preview":
      return {
        value:
          typeof raw.url === "string"
            ? { kind: "preview", url: raw.url }
            : null,
        changed:
          typeof raw.url !== "string" ||
          Object.keys(raw).some((key) => key !== "kind" && key !== "url"),
      };
    default:
      return { value: null, changed: true };
  }
}

export type MigratedSerializedTabs = {
  tabs: SerializedTab[];
  sourceIndexes: number[];
  needsWrite: boolean;
};

export function migrateSerializedTabs(
  value: unknown,
  root: string | null,
): MigratedSerializedTabs {
  if (!Array.isArray(value)) {
    return { tabs: [], sourceIndexes: [], needsWrite: true };
  }
  const tabs: SerializedTab[] = [];
  const sourceIndexes: number[] = [];
  let needsWrite = false;
  value.forEach((tab, index) => {
    const migrated = migrateSerializedTab(tab, root);
    needsWrite ||= migrated.changed;
    if (migrated.value) {
      tabs.push(migrated.value);
      sourceIndexes.push(index);
    } else {
      needsWrite = true;
    }
  });
  return { tabs, sourceIndexes, needsWrite };
}

type HydratedTree = {
  tree: PaneNode;
  activeLeafId: number;
  firstLeafCwd?: string;
};

function hydrateNode(
  node: SerializedNode,
  root: string | null,
  allocId: () => number,
  acc: { activeLeafId: number | null },
): PaneNode {
  if (node.kind === "leaf") {
    const id = allocId();
    if (node.active && acc.activeLeafId === null) acc.activeLeafId = id;
    const cwd = resolveWorkstationPathRef(node.cwd, root);
    return {
      kind: "leaf",
      id,
      ...(cwd && { cwd }),
    };
  }
  const children = node.children.map((c) => hydrateNode(c, root, allocId, acc));
  if (children.length === 0) return { kind: "leaf", id: allocId() };
  if (children.length === 1) return children[0];
  return { kind: "split", id: allocId(), dir: node.dir, children };
}

function hydrateTree(
  tree: SerializedNode,
  root: string | null,
  allocId: () => number,
): HydratedTree {
  const acc: { activeLeafId: number | null } = { activeLeafId: null };
  const paneTree = hydrateNode(tree, root, allocId, acc);
  const leaves = collectLeaves(paneTree);
  const activeLeafId = acc.activeLeafId ?? leaves[0]?.id ?? allocId();
  const firstLeafCwd =
    leaves.find((l) => l.id === activeLeafId)?.cwd ?? leaves[0]?.cwd;
  return { tree: paneTree, activeLeafId, firstLeafCwd };
}

function collectLeaves(node: PaneNode): Array<{ id: number; cwd?: string }> {
  if (isLeaf(node)) return [{ id: node.id, cwd: node.cwd }];
  return node.children.flatMap(collectLeaves);
}

function hydrateTab(
  s: SerializedTab,
  spaceId: string,
  root: string | null,
  allocId: () => number,
): Tab | null {
  switch (s.kind) {
    case "terminal": {
      const { tree, activeLeafId, firstLeafCwd } = hydrateTree(
        s.tree,
        root,
        allocId,
      );
      const title =
        s.customTitle ??
        (firstLeafCwd ? basename(firstLeafCwd) : s.blocks ? "blocks" : "shell");
      return {
        id: allocId(),
        kind: "terminal",
        spaceId,
        cold: true,
        title,
        cwd: firstLeafCwd,
        paneTree: tree,
        activeLeafId,
        ...(s.blocks && { blocks: true }),
        ...(s.customTitle !== undefined && { customTitle: s.customTitle }),
      } satisfies TerminalTab;
    }
    case "editor": {
      const pathRef = normalizePathRef(s.path);
      if (!pathRef?.path) return null;
      const path = resolveWorkstationPathRef(pathRef, root);
      if (!path) return null;
      return {
        id: allocId(),
        kind: "editor",
        spaceId,
        cold: true,
        title: basename(path),
        path,
        dirty: false,
        preview: false,
      } satisfies EditorTab;
    }
    case "preview":
      return {
        id: allocId(),
        kind: "preview",
        spaceId,
        cold: true,
        title: titleFromUrl(s.url),
        url: s.url,
      } satisfies PreviewTab;
    case "markdown": {
      const pathRef = normalizePathRef(s.path);
      if (!pathRef?.path) return null;
      const path = resolveWorkstationPathRef(pathRef, root);
      if (!path) return null;
      return {
        id: allocId(),
        kind: "markdown",
        spaceId,
        cold: true,
        title: basename(path),
        path,
      } satisfies MarkdownTab;
    }
    default:
      return null;
  }
}

export function freshTerminalTab(
  spaceId: string,
  cwd: string | null,
  allocId: () => number,
): TerminalTab {
  const leafId = allocId();
  return {
    id: allocId(),
    kind: "terminal",
    spaceId,
    cold: true,
    title: cwd ? basename(cwd) : "shell",
    cwd: cwd ?? undefined,
    paneTree: { kind: "leaf", id: leafId, ...(cwd && { cwd }) },
    activeLeafId: leafId,
  };
}

export function hydrateTabs(
  serialized: SerializedTab[],
  spaceId: string,
  root: string | null,
  allocId: () => number,
): Tab[] {
  if (!Array.isArray(serialized)) return [];
  const out: Tab[] = [];
  for (const s of serialized) {
    try {
      const tab = hydrateTab(s, spaceId, root, allocId);
      if (tab) out.push(tab);
    } catch {
      // Skip corrupted entries rather than failing the whole restore.
    }
  }
  return out;
}
