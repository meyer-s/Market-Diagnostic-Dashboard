import { describe, expect, it } from "vitest";

import { ApiError } from "../apiUtils";
import {
  isMissingThesisAssessmentError,
  shouldGenerateInitialThesisAssessment,
} from "../thesisAssessment";

describe("shouldGenerateInitialThesisAssessment", () => {
  const missing = new ApiError(
    "/secret/options/positions/68/thesis-assessment",
    404,
    "No thesis assessment has been recorded; create one with POST /positions/{position_id}/thesis-assessment."
  );

  it("repairs a missing initial grade for a write-scoped read", () => {
    expect(isMissingThesisAssessmentError(missing)).toBe(true);
    expect(
      shouldGenerateInitialThesisAssessment(missing, {
        force: false,
        scope: "write",
      })
    ).toBe(true);
  });

  it("does not turn read-only access into a write", () => {
    expect(
      shouldGenerateInitialThesisAssessment(missing, {
        force: false,
        scope: "read",
      })
    ).toBe(false);
  });

  it("does not retry explicit refreshes or unrelated 404s", () => {
    expect(
      shouldGenerateInitialThesisAssessment(missing, {
        force: true,
        scope: "write",
      })
    ).toBe(false);
    const positionMissing = new ApiError(
      "/secret/options/positions/999/thesis-assessment",
      404,
      "Position not found"
    );
    expect(isMissingThesisAssessmentError(positionMissing)).toBe(false);
    expect(
      shouldGenerateInitialThesisAssessment(
        positionMissing,
        {
          force: false,
          scope: "write",
        }
      )
    ).toBe(false);
  });
});
