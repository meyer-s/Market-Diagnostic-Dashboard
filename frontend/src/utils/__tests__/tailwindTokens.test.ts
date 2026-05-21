import { describe, expect, it } from "vitest";

import { findMissingStealthTokens } from "../../../scripts/check-tailwind-tokens.mjs";

describe("tailwind stealth token coverage", () => {
  it("defines every stealth token used in source", () => {
    expect(findMissingStealthTokens()).toEqual([]);
  });
});
