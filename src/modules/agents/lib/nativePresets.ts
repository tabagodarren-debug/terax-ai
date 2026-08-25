import type { AfflowPresetLauncherId } from "@/modules/agents/lib/presets";
import { invoke } from "@tauri-apps/api/core";

export type DetectableAgentCliId = Exclude<AfflowPresetLauncherId, "custom">;

export type AgentCliDetection = {
  id: DetectableAgentCliId;
  command: string;
  available: boolean;
  resolvedPath: string | null;
};

export type WorkstationFileRequest = {
  rootPath: string;
  relativePath: string;
};

export type WorkstationFileResolution = {
  root: string;
  relativePath: string;
  absolutePath: string;
};

export type AuthorizedWorkstationRoot = {
  workstationId: string;
  root: string;
};

export function rootForWorkstation(
  authorized: AuthorizedWorkstationRoot | null,
  workstationId: string | null | undefined,
): string | null {
  return authorized && workstationId === authorized.workstationId
    ? authorized.root
    : null;
}

export function detectAgentClis(): Promise<AgentCliDetection[]> {
  return invoke<AgentCliDetection[]>("agent_cli_detect");
}

export function resolveWorkstationFile(
  request: WorkstationFileRequest,
): Promise<WorkstationFileResolution> {
  return invoke<WorkstationFileResolution>("workstation_resolve_file", {
    request,
  });
}
