import { describe, expect, it } from "vitest";

import {
  classifyCollectionEvidence,
  classifyResourceEvidence,
  combineEvidenceStates,
} from "./evidenceState";

describe("evidence state contracts", () => {
  it.each([
    ["loading", null, true, null, false],
    ["complete", [{ id: 1 }], false, null, false],
    ["partial", [{ id: 1 }], false, null, true],
    ["stale", [{ id: 1 }], false, "refresh failed", false],
    ["empty", [], false, null, false],
    ["error", null, false, "provider unavailable", false],
  ] as const)(
    "classifies %s collection evidence deterministically",
    (expected, data, loading, error, partial) => {
      expect(classifyCollectionEvidence({ data, loading, error, partial })).toBe(expected);
    },
  );

  it("treats retained evidence as stale while a newer request is loading", () => {
    expect(
      classifyResourceEvidence({
        available: true,
        loading: true,
        error: null,
      }),
    ).toBe("stale");
  });

  it.each([
    [["complete", "complete"], "complete"],
    [["loading", "loading"], "loading"],
    [["empty", "empty"], "empty"],
    [["error", "error"], "error"],
    [["complete", "empty"], "partial"],
    [["complete", "error"], "partial"],
    [["complete", "stale"], "stale"],
  ] as const)("combines %j as %s", (states, expected) => {
    expect(combineEvidenceStates(states)).toBe(expected);
  });
});
