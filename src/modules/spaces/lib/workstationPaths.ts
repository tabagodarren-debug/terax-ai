import type { SpaceMeta } from "./store";

export function normalizeWorkstationRoot(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/");
  if (/^[A-Za-z]:\/$/.test(normalized) || normalized === "/") {
    return normalized;
  }
  return normalized.replace(/\/+$/, "");
}

function rootComparisonKey(path: string): string {
  const normalized = normalizeWorkstationRoot(path);
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}

export function workstationNameFromRoot(path: string): string {
  const normalized = normalizeWorkstationRoot(path);
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "Workstation";
}

export function findWorkstationByRoot(
  workstations: readonly Pick<SpaceMeta, "id" | "root">[],
  root: string,
): string | null {
  const key = rootComparisonKey(root);
  return (
    workstations.find(
      (workstation) =>
        workstation.root !== null &&
        rootComparisonKey(workstation.root) === key,
    )?.id ?? null
  );
}
