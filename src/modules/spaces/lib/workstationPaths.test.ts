import { describe, expect, it } from "vitest";
import {
  findWorkstationByRoot,
  normalizeWorkstationRoot,
  workstationNameFromRoot,
} from "./workstationPaths";

describe("workstation paths", () => {
  it("normalizes separators and trailing slashes", () => {
    expect(normalizeWorkstationRoot(" C:\\Work\\Fit Check\\ ")).toBe(
      "C:/Work/Fit Check",
    );
    expect(normalizeWorkstationRoot("/work/fit-check/")).toBe(
      "/work/fit-check",
    );
  });

  it("preserves filesystem roots", () => {
    expect(normalizeWorkstationRoot("C:/")).toBe("C:/");
    expect(normalizeWorkstationRoot("/")).toBe("/");
  });

  it("derives a workstation name from either path style", () => {
    expect(workstationNameFromRoot("C:\\Work\\Fit Check")).toBe("Fit Check");
    expect(workstationNameFromRoot("/work/realistic-ai/")).toBe("realistic-ai");
  });

  it("matches Windows roots without case or separator sensitivity", () => {
    expect(
      findWorkstationByRoot(
        [{ id: "fit", root: "C:\\Work\\Fit Check" }],
        "c:/work/fit check/",
      ),
    ).toBe("fit");
  });

  it("keeps Unix root comparison case-sensitive", () => {
    expect(
      findWorkstationByRoot(
        [{ id: "fit", root: "/work/Fit-Check" }],
        "/work/fit-check",
      ),
    ).toBeNull();
  });
});
