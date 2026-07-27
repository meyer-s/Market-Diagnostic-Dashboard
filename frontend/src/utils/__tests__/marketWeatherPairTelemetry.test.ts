import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  markPairOverviewVisible,
  trackPairEvent,
  trackSubsequentOptionsOpen,
} from "../marketWeatherPairTelemetry";

describe("Market Weather Pair product telemetry", () => {
  const gtag = vi.fn();

  beforeEach(() => {
    gtag.mockReset();
    (window as unknown as { gtag?: typeof gtag }).gtag = gtag;
    window.sessionStorage.clear();
  });

  it("uses a bounded versioned payload rather than the full receipt", () => {
    trackPairEvent("pair_basis_changed", "a".repeat(64), {
      basis: "context",
      timeframe: "1D",
    });

    expect(gtag).toHaveBeenCalledWith("event", "pair_basis_changed", {
      pair_telemetry_version: "pair_product_telemetry_v1",
      comparison_hash_prefix: "a".repeat(16),
      basis: "context",
      timeframe: "1D",
    });
  });

  it("names the mount timing as a neutral second-frame boundary", () => {
    trackPairEvent("pair_surface_second_frame", "c".repeat(64), {
      client_mount_to_second_frame_ms: 18,
      timeframe: "1D",
    });

    expect(gtag).toHaveBeenCalledWith("event", "pair_surface_second_frame", {
      pair_telemetry_version: "pair_product_telemetry_v1",
      comparison_hash_prefix: "c".repeat(16),
      client_mount_to_second_frame_ms: 18,
      timeframe: "1D",
    });
  });

  it("records one same-session downstream options open after visible Pair content", () => {
    markPairOverviewVisible("b".repeat(64), "1D");

    trackSubsequentOptionsOpen();
    trackSubsequentOptionsOpen();

    const downstreamCalls = gtag.mock.calls.filter((call) => call[1] === "pair_subsequent_options_opened");
    expect(downstreamCalls).toHaveLength(1);
    expect(downstreamCalls[0][2]).toMatchObject({
      pair_telemetry_version: "pair_product_telemetry_v1",
      comparison_hash_prefix: "b".repeat(16),
      source_timeframe: "1D",
    });
  });
});
