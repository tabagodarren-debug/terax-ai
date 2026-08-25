import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceEnv } from "@/modules/workspace";

export type ScaffoldRequest = {
  rootPath: string;
  workstationId: string;
  name: string;
};

export type ScaffoldReport = {
  root: string;
  createdDirs: string[];
  createdFiles: string[];
  skippedFiles: string[];
  manifestWritten: boolean;
};

export function scaffoldWorkstation(
  request: ScaffoldRequest,
): Promise<ScaffoldReport> {
  return invoke<ScaffoldReport>("workstation_scaffold", { request });
}

export function authorizeWorkstationRoot(
  path: string,
  workspace: WorkspaceEnv,
): Promise<string> {
  return invoke<string>("workspace_authorize", { path, workspace });
}
