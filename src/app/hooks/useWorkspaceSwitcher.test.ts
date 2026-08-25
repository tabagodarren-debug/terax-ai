import { workspaceSwitchBlockedMessage } from "@/app/hooks/workspaceSwitchGuards";
import { describe, expect, it } from "vitest";

describe("workspaceSwitchBlockedMessage", () => {
  it("prioritizes unsaved editor changes", () => {
    expect(
      workspaceSwitchBlockedMessage({ dirtyIds: [1], busyLeafIds: [10] }),
    ).toBe("Save or close unsaved editor tabs before switching workspace.");
  });

  it("reports one or several running terminal processes", () => {
    expect(
      workspaceSwitchBlockedMessage({ dirtyIds: [], busyLeafIds: [10] }),
    ).toBe("Stop the running terminal process before switching workspace.");
    expect(
      workspaceSwitchBlockedMessage({ dirtyIds: [], busyLeafIds: [10, 20] }),
    ).toBe("Stop the running terminal processes before switching workspace.");
  });

  it("allows a switch with no destructive hazards", () => {
    expect(
      workspaceSwitchBlockedMessage({ dirtyIds: [], busyLeafIds: [] }),
    ).toBeNull();
  });
});
