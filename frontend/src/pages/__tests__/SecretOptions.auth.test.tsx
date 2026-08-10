import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSecretOptionsToken,
  isSecretOptionsReadScopeAppend,
  setSecretOptionsScope,
  setSecretOptionsToken,
} from "../../utils/secretOptionsAuth";
import SecretOptions, { formatLearningCanaryLabel } from "../SecretOptions";

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
}));

vi.mock("../../utils/apiUtils", async () => {
  const actual = await vi.importActual<typeof import("../../utils/apiUtils")>("../../utils/apiUtils");
  return {
    ...actual,
    apiFetch: apiFetchMock,
  };
});

const renderPage = () => render(
  <MemoryRouter>
    <SecretOptions />
  </MemoryRouter>,
);

const emptyReadWorkspaceResponse = (endpoint: string) => {
  if (endpoint === "/secret/options/access") {
    return Promise.resolve({ actor: "reader", scope: "read", auth_mode: "bearer", request_id: "req-1" });
  }
  if (endpoint.startsWith("/secret/options/positions")) {
    return Promise.resolve({ positions: [], metrics_cache: null });
  }
  if (endpoint === "/secret/options/position-row-context") {
    return Promise.resolve({ contexts_by_position: {} });
  }
  if (endpoint === "/secret/options/decision-review-windows") {
    return Promise.resolve({ windows_by_position: {} });
  }
  if (endpoint.startsWith("/secret/options/optionality-clusters")) {
    return Promise.resolve({ clusters: [] });
  }
  if (endpoint.startsWith("/secret/options/scanner-summary")) {
    return Promise.reject(new Error("Scanner summary is outside this auth test."));
  }
  return Promise.reject(new Error(`Unexpected Secret Options test endpoint: ${endpoint}`));
};

const activeScannerRun = () => {
  const updatedAt = new Date();
  const startedAt = new Date(updatedAt.getTime() - 2 * 60_000);
  return {
    id: 92,
    universe_key: "SP500",
    universe_label: "S&P 500",
    threshold: 30,
    trigger_source: "dashboard",
    status: "running",
    total_symbols: 500,
    scanned_symbols: 125,
    hits: 0,
    errors: 0,
    rate_limit_errors: 0,
    hit_symbols: [],
    notes: null,
    last_event: "Scanning",
    last_symbol: "MSFT",
    last_error: null,
    started_at: startedAt.toISOString(),
    completed_at: null,
    updated_at: updatedAt.toISOString(),
  };
};

const readWorkspaceWithActiveScanner = (endpoint: string) => {
  if (endpoint.startsWith("/secret/options/scanner-summary")) {
    return Promise.resolve({
      lookback_days: 45,
      generated_at: "2026-07-29T12:02:00",
      summary: {
        event_count: 0,
        symbol_count: 0,
        delivered: 0,
        failed: 0,
        latest_event_at: null,
        runs_returned: 1,
        active_runs: 1,
        avg_hit_rate: 0,
      },
      top_symbols: [],
      ranked_opportunities: [],
      runs: [activeScannerRun()],
      supported_universes: [{ key: "SP500", label: "S&P 500" }],
    });
  }
  return emptyReadWorkspaceResponse(endpoint);
};

const writeWorkspaceWithoutScannerRun = (endpoint: string, options?: RequestInit) => {
  if (endpoint === "/secret/options/access") {
    return Promise.resolve({
      actor: "writer",
      scope: "write",
      auth_mode: "bearer",
      request_id: "req-write",
    });
  }
  if (endpoint.startsWith("/secret/options/scanner-summary")) {
    return Promise.resolve({
      lookback_days: 45,
      generated_at: "2026-07-29T12:02:00",
      summary: {
        event_count: 0,
        symbol_count: 0,
        delivered: 0,
        failed: 0,
        latest_event_at: null,
        runs_returned: 0,
        active_runs: 0,
        avg_hit_rate: 0,
      },
      top_symbols: [],
      ranked_opportunities: [],
      runs: [],
      supported_universes: [{ key: "SP500", label: "S&P 500" }],
    });
  }
  if (endpoint === "/secret/options/scanner-run" && options?.method === "POST") {
    return Promise.resolve({
      status: "queued",
      run: { ...activeScannerRun(), status: "queued", scanned_symbols: 0 },
    });
  }
  return emptyReadWorkspaceResponse(endpoint);
};

describe("Secret Options authorization gate", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    clearSecretOptionsToken();
    window.sessionStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    clearSecretOptionsToken();
    window.sessionStorage.clear();
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    vi.restoreAllMocks();
  });

  it("never renders the private workspace while an in-memory credential is being rejected", async () => {
    setSecretOptionsToken("stale-token");
    setSecretOptionsScope("write");
    apiFetchMock.mockRejectedValue(new Error("Unauthorized"));

    renderPage();

    expect(screen.getByText("Private workspace locked")).not.toBeNull();
    expect(screen.queryByText("Position summary")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Options workspaces" })).toBeNull();

    await waitFor(() => {
      expect(screen.getByText(/credential was rejected/i)).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    });
    expect(screen.queryByText(/session unlocked/i)).toBeNull();
  });

  it("keeps an invalid credential on the locked screen", async () => {
    apiFetchMock.mockRejectedValue(new Error("Unauthorized"));
    const user = userEvent.setup();
    renderPage();

    const credential = screen.getByLabelText("Bearer credential");
    await user.type(credential, "not-valid");
    await user.click(screen.getByRole("button", { name: "Unlock session" }));

    await waitFor(() => expect(screen.getByText(/credential was rejected/i)).not.toBeNull());
    expect(screen.getByText("Private workspace locked")).not.toBeNull();
    expect(screen.queryByText("Position summary")).toBeNull();
    expect(screen.queryByText(/session unlocked/i)).toBeNull();
  });

  it("does not let a successful background read close a write-credential prompt", async () => {
    setSecretOptionsToken("read-token");
    setSecretOptionsScope("read");
    let resolvePositions: ((value: unknown) => void) | undefined;
    const positionsPending = new Promise((resolve) => {
      resolvePositions = resolve;
    });
    apiFetchMock.mockImplementation((endpoint: string) => {
      if (endpoint === "/secret/options/access") {
        return Promise.resolve({ actor: "reader", scope: "read", auth_mode: "bearer", request_id: "req-2" });
      }
      if (endpoint.startsWith("/secret/options/positions")) return positionsPending;
      return emptyReadWorkspaceResponse(endpoint);
    });
    const user = userEvent.setup();
    renderPage();

    const upgrade = await screen.findByRole("button", { name: "Use write credential" });
    await user.click(upgrade);
    expect(screen.getByText("Private workspace locked")).not.toBeNull();
    expect(screen.getByText(/Enter a write-scoped credential/i)).not.toBeNull();

    await act(async () => {
      resolvePositions?.({ positions: [], metrics_cache: null });
      await positionsPending;
    });

    await waitFor(() => expect(screen.getByText("Private workspace locked")).not.toBeNull());
    expect(screen.queryByText("Position summary")).toBeNull();
  });

  it("shows a mobile lock control and disables mutations for a read session", async () => {
    setSecretOptionsToken("read-token");
    setSecretOptionsScope("read");
    apiFetchMock.mockImplementation(emptyReadWorkspaceResponse);
    renderPage();

    const lock = await screen.findByRole("button", { name: "Lock Secret Options read access" });
    expect(lock).not.toBeNull();
    const add = screen.getByRole("button", { name: "Add" });
    expect(add.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/mutations are blocked before an API request is sent/i)).not.toBeNull();
  });

  it("disables every mobile scanner write control in read scope without sending a scanner POST", async () => {
    setSecretOptionsToken("read-token");
    setSecretOptionsScope("read");
    apiFetchMock.mockImplementation(readWorkspaceWithActiveScanner);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "scanner" }));

    expect((await screen.findByRole("button", { name: "Running" })).hasAttribute("disabled")).toBe(true);
    expect((screen.getByRole("button", { name: "Stop scan" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Universe") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("IV/HV max %") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Scanner controls require write scope/i)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Running" }));
    await user.click(screen.getByRole("button", { name: "Stop scan" }));
    expect(
      apiFetchMock.mock.calls.filter(([endpoint, options]) => (
        String(endpoint).startsWith("/secret/options/scanner-run")
        && options?.method === "POST"
      )),
    ).toHaveLength(0);
  });

  it("disables every desktop scanner write control in read scope", async () => {
    setSecretOptionsToken("read-token");
    setSecretOptionsScope("read");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(min-width: 1280px)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    apiFetchMock.mockImplementation(readWorkspaceWithActiveScanner);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "scanner" }));
    expect((await screen.findByRole("button", { name: "Running" })).hasAttribute("disabled")).toBe(true);
    expect((screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Universe") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("IV/HV max %") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Scanner controls require write scope/i)).not.toBeNull();
  });

  it("enables scanner inputs and sends the bounded run request in write scope", async () => {
    setSecretOptionsToken("write-token");
    setSecretOptionsScope("write");
    apiFetchMock.mockImplementation(writeWorkspaceWithoutScannerRun);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "scanner" }));

    const run = await screen.findByRole("button", { name: /^Run$/ });
    expect((run as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText("Universe") as HTMLSelectElement).disabled).toBe(false);
    expect((screen.getByLabelText("IV/HV max %") as HTMLInputElement).disabled).toBe(false);

    await user.click(run);
    await waitFor(() => {
      const request = apiFetchMock.mock.calls.find(
        ([endpoint, options]) =>
          endpoint === "/secret/options/scanner-run" && options?.method === "POST",
      );
      expect(request?.[1]).toMatchObject({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      expect(JSON.parse(String(request?.[1]?.body))).toEqual({
        universe_key: "SP500",
        threshold: 100,
      });
    });
  });

  it("records authenticated rank, visibility, and detail impressions for a frozen scanner ranking", async () => {
    setSecretOptionsToken("read-token");
    setSecretOptionsScope("read");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    class VisibleIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0.5];

      constructor(private readonly callback: IntersectionObserverCallback) {}

      observe(target: Element) {
        this.callback(
          [
            {
              target,
              isIntersecting: true,
              intersectionRatio: 1,
            } as IntersectionObserverEntry,
          ],
          this as unknown as IntersectionObserver,
        );
      }

      disconnect() {}
      unobserve() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: VisibleIntersectionObserver,
    });
    const run = {
      id: 91,
      universe_key: "SP500",
      universe_label: "S&P 500",
      threshold: 30,
      trigger_source: "dashboard",
      status: "completed",
      total_symbols: 500,
      scanned_symbols: 500,
      hits: 1,
      errors: 0,
      rate_limit_errors: 0,
      hit_symbols: ["TEST"],
      notes: null,
      last_event: "completed",
      last_symbol: null,
      last_error: null,
      started_at: "2026-07-26T12:00:00",
      completed_at: "2026-07-26T12:10:00",
      updated_at: "2026-07-26T12:10:00",
    };
    const hit = {
      event_id: 501,
      scan_ordinal: 1,
      display_ordinal: 1,
      champion_rank: 1,
      counterfactual_rank: 1,
      applied_rank: 1,
      champion_score: 81,
      counterfactual_score: 82,
      applied_score: 82,
      applied_weight: 0.1,
      symbol: "TEST",
      triggered_at: "2026-07-26T12:08:00",
      group: "Research",
      sector: "Technology",
      score: 82,
      base_score: 81,
      grade: "A",
      model_version: "opportunity-v1",
      components: {},
      reasons: [],
      message: null,
      iv_percentile: null,
      iv30: null,
      hv30: null,
      iv_hv_spread: null,
      avg_edr: null,
      selected_contract: {
        expiry: null,
        dte: null,
        strike: null,
        option_type: null,
        premium: null,
        spread_pct: null,
        open_interest: null,
        volume: null,
        implied_volatility: null,
        contract_score: null,
        reward_risk: null,
        convexity_profit_pct: null,
        convexity_probability_itm: null,
      },
    };
    apiFetchMock.mockImplementation((endpoint: string) => {
      if (endpoint === "/secret/options/access") {
        return Promise.resolve({ actor: "reader", scope: "read", auth_mode: "bearer", request_id: "req-telemetry" });
      }
      if (endpoint.startsWith("/secret/options/positions")) {
        return Promise.resolve({ positions: [], metrics_cache: null });
      }
      if (endpoint === "/secret/options/position-row-context") {
        return Promise.resolve({ contexts_by_position: {} });
      }
      if (endpoint === "/secret/options/decision-review-windows") {
        return Promise.resolve({ windows_by_position: {} });
      }
      if (endpoint.startsWith("/secret/options/optionality-clusters")) {
        return Promise.resolve({ clusters: [] });
      }
      if (endpoint.startsWith("/secret/options/scanner-summary")) {
        return Promise.resolve({
          lookback_days: 45,
          generated_at: "2026-07-26T12:11:00",
          summary: {
            event_count: 0,
            symbol_count: 0,
            delivered: 0,
            failed: 0,
            latest_event_at: null,
            runs_returned: 1,
            active_runs: 0,
            avg_hit_rate: 0,
          },
          top_symbols: [],
          ranked_opportunities: [],
          runs: [run],
          supported_universes: [{ key: "SP500", label: "S&P 500" }],
        });
      }
      if (endpoint === "/secret/options/scanner-run/91") {
        return Promise.resolve({
          run,
          hit_count: 1,
          matched_event_count: 1,
          hits: [hit],
          ranking_snapshot: {
            id: 7,
            snapshot_uuid: "snapshot-uuid-0000000000000001",
            schema_version: "option_scanner_rank_snapshot_v1",
            surface: "scanner_run_detail",
            scope_key: "run:91",
            sweep_run_id: 91,
            learning_policy_version: "test-v1",
            opportunity_model_versions: [],
            ranking_model_versions: [],
            candidate_count: 1,
            payload_sha256: "a".repeat(64),
            integrity_verified: true,
            source_generated_at: "2026-07-26T12:10:00",
            created_at: "2026-07-26T12:10:01",
            candidates: [
              {
                event_id: 501,
                symbol: "TEST",
                scan_ordinal: 1,
                display_ordinal: 1,
                champion_rank: 1,
                counterfactual_rank: 1,
                applied_rank: 1,
                champion_score: 81,
                counterfactual_score: 82,
                applied_score: 82,
                applied_weight: 0.1,
                opportunity_model_version: "opportunity-v1",
                ranking_model_version: "learning-v1",
              },
            ],
          },
        });
      }
      if (endpoint === "/secret/options/scanner-impressions") {
        return Promise.resolve({
          snapshot_id: 7,
          inserted: 1,
          skipped_duplicates: 0,
          received: 1,
        });
      }
      return Promise.reject(new Error(`Unexpected Secret Options telemetry test endpoint: ${endpoint}`));
    });

    const user = userEvent.setup();
    renderPage();

    const scannerTab = await screen.findByRole("tab", { name: "scanner" });
    await waitFor(() => {
      expect(apiFetchMock.mock.calls.some(([endpoint]) => String(endpoint).startsWith("/secret/options/scanner-summary"))).toBe(true);
    });
    expect(apiFetchMock.mock.calls.some(([endpoint]) => endpoint === "/secret/options/scanner-run/91")).toBe(false);
    expect(apiFetchMock.mock.calls.some(([endpoint]) => endpoint === "/secret/options/scanner-impressions")).toBe(false);

    await user.click(scannerTab);

    await waitFor(() => {
      const types = apiFetchMock.mock.calls
        .filter(([endpoint]) => endpoint === "/secret/options/scanner-impressions")
        .flatMap(([, options]) => JSON.parse(String(options?.body)).exposures)
        .map((exposure) => exposure.exposure_type);
      expect(types).toContain("ranking_rendered");
      expect(types).toContain("candidate_visible");
    });
    const impressionCall = apiFetchMock.mock.calls.find(
      ([endpoint]) => endpoint === "/secret/options/scanner-impressions",
    );
    expect(impressionCall?.[1]).toMatchObject({
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
    });
    const payload = JSON.parse(String(impressionCall?.[1]?.body));
    expect(payload.snapshot_id).toBe(7);
    expect(payload.page_session_id.length).toBeGreaterThanOrEqual(16);
    expect(payload.exposures[0]).toMatchObject({
      exposure_type: "ranking_rendered",
      metadata: { candidate_count: 1, run_id: 91 },
    });
    await user.click(
      await screen.findByRole("button", {
        name: "Open scanner hit details for TEST",
      }),
    );
    await waitFor(() => {
      const types = apiFetchMock.mock.calls
        .filter(([endpoint]) => endpoint === "/secret/options/scanner-impressions")
        .flatMap(([, options]) => JSON.parse(String(options?.body)).exposures)
        .map((exposure) => exposure.exposure_type);
      expect(types).toContain("candidate_detail_opened");
    });
  });

  it("allows read scope append only for the exact scanner telemetry endpoint", () => {
    expect(
      isSecretOptionsReadScopeAppend(
        "/secret/options/scanner-impressions",
        "POST",
      ),
    ).toBe(true);
    expect(
      isSecretOptionsReadScopeAppend("/secret/options/scanner-run", "POST"),
    ).toBe(false);
    expect(
      isSecretOptionsReadScopeAppend(
        "/secret/options/scanner-impressions/extra",
        "POST",
      ),
    ).toBe(false);
    expect(
      isSecretOptionsReadScopeAppend(
        "/secret/options/scanner-impressions",
        "DELETE",
      ),
    ).toBe(false);
  });
});

describe("Secret Options learning canary labels", () => {
  it("renders the receipt cap instead of a hardcoded policy weight", () => {
    expect(formatLearningCanaryLabel(0.10, "option_learning_influence_canary_v3")).toBe(
      "Live ≤10% canary",
    );
    expect(formatLearningCanaryLabel(0.075, "future-policy")).toBe("Live ≤8% canary");
    expect(formatLearningCanaryLabel(undefined, "option_learning_influence_canary_v2")).toBe(
      "Live ≤5% canary",
    );
  });
});
