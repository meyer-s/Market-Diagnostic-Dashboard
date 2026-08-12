import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ContractSignalBadge, getContractSignalPresentation, isContractMarketClosed } from "./ContractSignalBadge";
import type { AgricultureContextData } from "./AgricultureContextPanel";

type SignalContext = Pick<AgricultureContextData, "context_score" | "session" | "setup_label" | "technical">;

function context(
  setupLabel: string,
  netBias: AgricultureContextData["context_score"]["net_bias"] = "neutral",
  technicalBias: NonNullable<AgricultureContextData["technical"]["bias"]> = "neutral",
  sessionStatus = "open"
): SignalContext {
  return {
    setup_label: setupLabel,
    session: { status: sessionStatus },
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
  ])("keeps the %s state explicit", (setupLabel, label) => {
    expect(getContractSignalPresentation(context(setupLabel, "bullish", "bearish")).label).toBe(label);
  });

  it.each([
    ["bullish", "bullish", "A\u2191"],
    ["bearish", "bearish", "A\u2193"],
    ["bullish", "neutral", "T\u2191"],
    ["neutral", "bearish", "F\u2193"],
    ["bullish", "bearish", "CONFLICT"],
    ["neutral", "mixed", "WATCH"],
    ["neutral", "neutral", "AVOID"],
  ])("preserves the underlying %s/%s setup while the market is closed", (technicalBias, netBias, label) => {
    const closedContext = context("closed/no execution", netBias, technicalBias, "closed");
    expect(getContractSignalPresentation(closedContext).label).toBe(label);
    expect(isContractMarketClosed(closedContext)).toBe(true);
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

  it("announces closed status as secondary context instead of replacing the setup", () => {
    render(
      <button type="button">
        <span aria-hidden="true">ZC</span>
        <ContractSignalBadge symbol="ZC" context={context("closed/no execution", "bullish", "bullish", "closed")} />
      </button>
    );

    expect(screen.getByRole("button", { name: "ZC, Aligned long, market closed" })).not.toBeNull();
  });
});
