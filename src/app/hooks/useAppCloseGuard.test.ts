import { describe, expect, it } from "vitest";
import {
  canOptOutOfAppClosePrompt,
  evaluateAppCloseBlocker,
} from "./useAppCloseGuard";

describe("canOptOutOfAppClosePrompt", () => {
  it("offers the opt-out when a running process is the only blocker", () => {
    expect(
      canOptOutOfAppClosePrompt({ dirtyEditors: 0, busyTerminal: true }),
    ).toBe(true);
  });

  it("withholds the opt-out whenever unsaved changes are also at stake", () => {
    expect(
      canOptOutOfAppClosePrompt({ dirtyEditors: 1, busyTerminal: true }),
    ).toBe(false);
    expect(
      canOptOutOfAppClosePrompt({ dirtyEditors: 2, busyTerminal: false }),
    ).toBe(false);
  });
});

describe("evaluateAppCloseBlocker", () => {
  it("rechecks dirty editors while terminal activity is being inspected", async () => {
    let pass = 0;
    await expect(
      evaluateAppCloseBlocker(
        () => ({
          dirtyIds: pass++ === 0 ? [] : [7],
          leafIds: [12],
        }),
        async () => false,
        true,
      ),
    ).resolves.toEqual({ dirtyEditors: 1, busyTerminal: false });
  });

  it("treats a failed terminal activity probe as busy", async () => {
    await expect(
      evaluateAppCloseBlocker(
        () => ({ dirtyIds: [], leafIds: [12] }),
        async () => {
          throw new Error("native check failed");
        },
        true,
      ),
    ).resolves.toEqual({ dirtyEditors: 0, busyTerminal: true });
  });
});
