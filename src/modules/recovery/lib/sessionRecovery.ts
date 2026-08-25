import { saveState } from "@/modules/spaces/lib/store";
import { invoke } from "@tauri-apps/api/core";

export type SessionStartupKind = "firstRun" | "clean" | "unclean" | "corrupt";

export type SessionStartupStatus = {
  status: SessionStartupKind;
};

const SESSION_STARTUP_KINDS = new Set<SessionStartupKind>([
  "firstRun",
  "clean",
  "unclean",
  "corrupt",
]);

export function parseSessionStartupStatus(
  value: unknown,
): SessionStartupStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid session startup response");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    typeof record.status !== "string" ||
    !SESSION_STARTUP_KINDS.has(record.status as SessionStartupKind)
  ) {
    throw new Error("Invalid session startup response");
  }
  return { status: record.status as SessionStartupKind };
}

export async function readSessionStartupStatus(): Promise<SessionStartupStatus> {
  return parseSessionStartupStatus(await invoke("session_startup_status"));
}

export function acknowledgeSessionRecovery(): Promise<void> {
  return invoke("session_acknowledge_recovery");
}

export function markSessionClean(): Promise<void> {
  return invoke("session_mark_clean");
}

export async function discardRecoveredTabState(
  workstationIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(workstationIds)];
  const results = await Promise.allSettled(
    ids.map((id) => saveState(id, { tabs: [], activeTabIndex: 0 })),
  );
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("Could not clear every restored tab snapshot.");
  }
}

export async function runRecoveryDiscard(
  discard: () => void | Promise<void>,
): Promise<string | null> {
  try {
    await discard();
    return null;
  } catch {
    return "Afflow could not clear the restored tabs. Try again or keep the recovered workspace.";
  }
}
