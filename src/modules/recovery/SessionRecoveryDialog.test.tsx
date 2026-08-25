import { recoveryDialogCopy } from "@/modules/recovery/SessionRecoveryDialog";
import { describe, expect, it } from "vitest";

describe("recoveryDialogCopy", () => {
  it("explains an unclean shutdown without promising live process recovery", () => {
    const copy = recoveryDialogCopy("unclean");

    expect(copy.title).toBe("Workspace recovered");
    expect(copy.description).toContain("last saved workstation and tabs");
    expect(copy.description).toContain("new sessions");
    expect(copy.description).toContain("browser windows are not restored");
  });

  it("distinguishes a corrupt marker from a known unclean exit", () => {
    const copy = recoveryDialogCopy("corrupt");

    expect(copy.title).toContain("could not be verified");
    expect(copy.description).toContain("session marker was invalid");
  });

  it("does not claim success when the saved state could not be loaded", () => {
    const copy = recoveryDialogCopy("unclean", true);

    expect(copy.title).toBe("Workspace recovery needs attention");
    expect(copy.description).toContain("could not load");
    expect(copy.description).toContain("files were not changed");
  });
});
