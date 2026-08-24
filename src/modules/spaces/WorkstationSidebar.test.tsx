import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  moveWorkstationIds,
  normalizeWorkstationName,
  WorkstationSidebar,
  type WorkstationSidebarProps,
  workstationRootLabel,
} from "./WorkstationSidebar";

const items = [
  {
    id: "one",
    name: "3D Humanoid",
    root: "C:\\Projects\\humanoid",
    color: "#22c55e",
  },
  {
    id: "two",
    name: "Fit Check",
    root: "C:\\Projects\\fit-check",
  },
  {
    id: "three",
    name: "Research",
    root: "/work/research/",
  },
] as const;

function props(
  overrides: Partial<WorkstationSidebarProps> = {},
): WorkstationSidebarProps {
  return {
    workstations: items,
    activeId: "two",
    onOpenWorkstation: vi.fn(),
    onCreateWorkstation: vi.fn(),
    onOpenExistingWorkstation: vi.fn(),
    onRenameWorkstation: vi.fn(),
    onReorderWorkstations: vi.fn(),
    onArchiveWorkstation: vi.fn(),
    ...overrides,
  };
}

describe("moveWorkstationIds", () => {
  it("moves a workstation one position without mutating the input", () => {
    const workstations = items.map(({ id }) => ({ id }));

    expect(moveWorkstationIds(workstations, "two", "up")).toEqual([
      "two",
      "one",
      "three",
    ]);
    expect(moveWorkstationIds(workstations, "two", "down")).toEqual([
      "one",
      "three",
      "two",
    ]);
    expect(workstations.map(({ id }) => id)).toEqual(["one", "two", "three"]);
  });

  it("rejects missing workstations and boundary moves", () => {
    expect(moveWorkstationIds(items, "missing", "up")).toBeNull();
    expect(moveWorkstationIds(items, "one", "up")).toBeNull();
    expect(moveWorkstationIds(items, "three", "down")).toBeNull();
  });
});

describe("workstationRootLabel", () => {
  it.each([
    ["C:\\Projects\\Afflow", "Afflow"],
    ["C:/Projects/Afflow/", "Afflow"],
    ["/home/user/project/", "project"],
    ["C:\\", "C:\\"],
    ["/", "/"],
    ["  ", "Root unavailable"],
  ])("creates a compact label for %s", (root, expected) => {
    expect(workstationRootLabel(root)).toBe(expected);
  });
});

describe("normalizeWorkstationName", () => {
  it("trims a valid name", () => {
    expect(normalizeWorkstationName("  Fit Check  ")).toBe("Fit Check");
  });

  it("rejects a blank name", () => {
    expect(normalizeWorkstationName(" \t ")).toBeNull();
  });
});

describe("WorkstationSidebar", () => {
  it("renders saved workstations and marks the active item", () => {
    const html = renderToStaticMarkup(<WorkstationSidebar {...props()} />);

    expect(html).toContain("Workstations");
    expect(html).toContain("3D Humanoid");
    expect(html).toContain("Fit Check");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("fit-check");
    expect(html).toContain('aria-label="Create workstation"');
    expect(html).toContain('aria-label="Open folder as workstation"');
    expect(html).toContain('aria-label="Rename workstation"');
    expect(html).toContain('aria-label="Archive workstation"');
  });

  it("shows empty, loading, error, and unavailable-root states", () => {
    const empty = renderToStaticMarkup(
      <WorkstationSidebar {...props({ workstations: [], activeId: null })} />,
    );
    const loading = renderToStaticMarkup(
      <WorkstationSidebar
        {...props({ workstations: [], activeId: null, loading: true })}
      />,
    );
    const error = renderToStaticMarkup(
      <WorkstationSidebar
        {...props({ error: "Store could not be read", onRetry: vi.fn() })}
      />,
    );
    const unavailable = renderToStaticMarkup(
      <WorkstationSidebar
        {...props({
          workstations: [
            {
              ...items[0],
              unavailable: true,
              unavailableReason: "Folder was moved",
            },
          ],
          activeId: null,
        })}
      />,
    );

    expect(empty).toContain("No workstations");
    expect(empty).toContain("Open folder");
    expect(loading).toContain('aria-label="Loading workstations"');
    expect(error).toContain('role="alert"');
    expect(error).toContain("Store could not be read");
    expect(error).toContain("Retry");
    expect(unavailable).toContain("Folder was moved");
    expect(unavailable).toContain("disabled");
  });
});
