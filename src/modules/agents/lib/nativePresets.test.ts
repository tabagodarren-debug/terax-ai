import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  detectAgentClis,
  resolveWorkstationFile,
  rootForWorkstation,
} from "./nativePresets";

describe("native preset commands", () => {
  it("does not expose a root until authorization and hydration agree", () => {
    expect(rootForWorkstation(null, null)).toBeNull();
    expect(
      rootForWorkstation(
        { workstationId: "workstation-a", root: "C:/a" },
        undefined,
      ),
    ).toBeNull();
    expect(
      rootForWorkstation(
        { workstationId: "workstation-a", root: "C:/a" },
        "workstation-b",
      ),
    ).toBeNull();
    expect(
      rootForWorkstation(
        { workstationId: "workstation-a", root: "C:/a" },
        "workstation-a",
      ),
    ).toBe("C:/a");
  });

  beforeEach(() => {
    invoke.mockReset();
  });

  it("detects agent CLIs without command parameters", async () => {
    invoke.mockResolvedValue([]);

    await detectAgentClis();

    expect(invoke).toHaveBeenCalledWith("agent_cli_detect");
  });

  it("passes file resolution through the approved request DTO", async () => {
    const request = {
      rootPath: "C:/workstation",
      relativePath: "outputs/result.md",
    };
    invoke.mockResolvedValue({
      root: request.rootPath,
      relativePath: request.relativePath,
      absolutePath: "C:/workstation/outputs/result.md",
    });

    await resolveWorkstationFile(request);

    expect(invoke).toHaveBeenCalledWith("workstation_resolve_file", {
      request,
    });
  });
});
