import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ContractSignalBadge, getContractSignalPresentation } from "./ContractSignalBadge";
import type { AgricultureContextData } from "./AgricultureContextPanel";

type SignalContext = Pick<AgricultureContextData, "context_score" | "setup_label" | "technical">;

function context(
  setupLabel: string,
  netBias: AgricultureContextData["context_score"]["net_bias"] = "neutral",
  technicalBias: NonNullable<AgricultureContextData["technical"]["bias"]> = "neutral"
): SignalContext {
  return {
    setup_label: setupLabel,
    context_score: {
      net_bias: netBias,
      confidence: "high",
      confidence_score: 75,
      numerical_score: 1,
      component_breakdown: {},
    },
    technical: { bias: technicalBias },
  };
}

afterEach(() => cleanup());

describe("contract signal presentation", () => {
  it.each([
    ["aligned long setup", "bullish", "bullish", "A\u2191", "Aligned long"],
    ["aligned short setup", "bearish", "bearish", "A\u2193", "Aligned short"],
    ["fundamental-only setup", "bullish", "neutral", "F\u2191", "Fundamental long"],
    ["fundamental-only setup", "bearish", "neutral", "F\u2193", "Fundamental short"],
    ["technical-only setup", "neutral", "bullish", "T\u2191", "Technical long"],
    ["technical-only setup", "neutral", "bearish", "T\u2193", "Technical short"],
  ])("maps %s to a directional badge", (setupLabel, netBias, technicalBias, label, description) => {
    expect(getContractSignalPresentation(context(setupLabel, netBias, technicalBias))).toMatchObject({ label, description });
  });

  it.each([
    ["watch", "WATCH"],
    ["avoid", "AVOID"],
    ["conflicting signals", "CONFLICT"],
    ["wait for report", "WAIT"],
    ["closed/no execution", "CLOSED"],
  ])("keeps the %s state explicit", (setupLabel, label) => {
    expect(getContractSignalPresentation(context(setupLabel, "bullish", "bearish")).label).toBe(label);
  });

  it("keeps loading, unavailable, and future backend states visible", () => {
    expect(getContractSignalPresentation(null, true).label).toBe("LOADING");
    expect(getContractSignalPresentation(null, false, "network error").label).toBe("N/A");
    expect(getContractSignalPresentation(context("manual review"))).toMatchObject({
      label: "MANUAL REVIEW",
      description: "manual review",
    });
  });

  it("expands the compact marker into a useful button name for assistive technology", () => {
    render(
      <button type="button">
        <span aria-hidden="true">ZC</span>
        <ContractSignalBadge symbol="ZC" context={context("aligned long setup", "bullish", "bullish")} />
      </button>
    );

    expect(screen.getByRole("button", { name: "ZC, Aligned long" })).not.toBeNull();
  });
});
