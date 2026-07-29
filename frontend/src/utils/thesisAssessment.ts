import { ApiError } from "./apiUtils";
import type { SecretOptionsScope } from "./secretOptionsAuth";

const MISSING_ASSESSMENT_MESSAGE = "No thesis assessment has been recorded";

export const isMissingThesisAssessmentError = (error: unknown) =>
  error instanceof ApiError
  && error.status === 404
  && error.message.startsWith(MISSING_ASSESSMENT_MESSAGE);

export const shouldGenerateInitialThesisAssessment = (
  error: unknown,
  {
    force,
    scope,
  }: {
    force: boolean;
    scope: SecretOptionsScope | null;
  }
) =>
  !force
  && (scope === "write" || scope === "development")
  && isMissingThesisAssessmentError(error);
