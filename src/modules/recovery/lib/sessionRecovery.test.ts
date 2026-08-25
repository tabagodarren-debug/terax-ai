import { beforeEach, describe, expect, it, vi } from "vitest";

const saveState = vi.hoisted(() => vi.fn());

vi.mock("@/modules/spaces/lib/store", () => ({ saveState }));

import {
  discardRecoveredTabState,
  parseSessionStartupStatus,
  runRecoveryDiscard,
} from "@/modules/recovery/lib/sessionRecovery";

describe("parseSessionStartupStatus", () => {
  it.each(["firstRun", "clean", "unclean", "corrupt"])(
    "accepts the exact %s response",
    (status) => {
      expect(parseSessionStartupStatus({ status })).toEqual({ status });
    },
  );

  it.each([
    null,
    [],
    {},
    { status: "running" },
    { status: "clean", extra: true },
  ])("rejects malformed or extended DTO %#", (value) => {
    expect(() => parseSessionStartupStatus(value)).toThrow(
      "Invalid session startup response",
    );
  });
});

describe("discardRecoveredTabState", () => {
  beforeEach(() => {
    saveState.mockReset().mockResolvedValue(undefined);
  });

  it("clears each workstation tab snapshot once", async () => {
    await discardRecoveredTabState(["one", "two", "one"]);

    expect(saveState).toHaveBeenCalledTimes(2);
    expect(saveState).toHaveBeenCalledWith("one", {
      tabs: [],
      activeTabIndex: 0,
    });
    expect(saveState).toHaveBeenCalledWith("two", {
      tabs: [],
      activeTabIndex: 0,
    });
  });

  it("reports a partial persistence failure", async () => {
    saveState
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("disk full"));

    await expect(discardRecoveredTabState(["one", "two"])).rejects.toThrow(
      "Could not clear every restored tab snapshot.",
    );
  });
});

describe("runRecoveryDiscard", () => {
  it("returns null after a successful discard", async () => {
    expect(await runRecoveryDiscard(vi.fn())).toBeNull();
  });

  it("returns actionable copy without exposing the storage error", async () => {
    const result = await runRecoveryDiscard(() => {
      throw new Error("C:/Users/person/private/path");
    });

    expect(result).toContain("could not clear the restored tabs");
    expect(result).not.toContain("private/path");
  });
});
