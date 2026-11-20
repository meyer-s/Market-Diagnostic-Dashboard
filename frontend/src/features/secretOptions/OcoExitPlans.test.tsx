import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OcoExitPlans } from "./OcoExitPlans";
import { apiFetch } from "../../utils/apiUtils";

vi.mock("../../utils/apiUtils", () => ({ apiFetch: vi.fn() }));
const clipboard = vi.fn().mockResolvedValue(undefined);
const row = (overrides = {}) => ({
  position_id: 1, fingerprint: "a".repeat(24), account: "Fixture account", symbol: "XYZ",
  contract_symbol: "-XYZ270115C100", expiration: "2027-01-15", strike: 100, option_type: "call",
  contracts: 3, actual_fill: 2.1, source_event_id: 11, source_triggered_at: "2026-11-18T15:00:00Z",
  source_is_candidate: true, levels: { entry_premium: 2, stop_premium: 1.2, target_premium: 3.5, target_basis: "Hump Exit" },
  status: "stop_crossed", reasons: [], warnings: ["This is an inferred candidate; verify in Fidelity."],
  indicative_mark: .8, mark_source: "last", last_trade_at: "2026-11-19T20:00:00Z", ...overrides,
});
const payload = (rows = [row()]) => ({ rows, summary: { lots: rows.length, with_levels: 1, stop_crossed: 1, needs_plan: 0 },
  as_of: "2026-11-20T14:00:00Z", broker_review: "Verify available quantity and existing orders in Fidelity.",
  fidelity_help_url: "https://www.fidelity.com/trading/faqs-order-types" });

describe("OCO exit plan references", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    vi.mocked(apiFetch).mockResolvedValue(payload());
  });

  it("copies original option levels without placing an order or marking it entered", async () => {
    render(<OcoExitPlans onClose={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "XYZ exit plan lot 1" });
    fireEvent.click(within(card).getByRole("button", { name: "Copy plan reference" }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(1));
    const text = clipboard.mock.calls[0][0];
    expect(text).toContain("Sell limit target: $3.50");
    expect(text).toContain("Sell stop trigger: $1.20 (option premium, NOT stock price)");
    expect(text).toContain("candidate association");
    expect(text).toContain("No broker order has been placed or verified");
    expect((within(card).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(apiFetch).toHaveBeenCalledWith("/secret/options/exit-plans");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("does not offer a plan or an entered checkbox when the saved contract mismatches", async () => {
    vi.mocked(apiFetch).mockResolvedValue(payload([row({ levels: null, status: "needs_plan", reasons: ["Saved scanner contract differs."] })]));
    render(<OcoExitPlans onClose={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "XYZ exit plan lot 1" });
    expect((within(card).getByRole("button", { name: "Copy plan reference" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(card).queryByRole("checkbox")).toBeNull();
    expect(within(card).getByText("Saved scanner contract differs.")).toBeTruthy();
  });

  it("invalidates the local entered note when a refreshed quantity changes the fingerprint", async () => {
    render(<OcoExitPlans onClose={vi.fn()} />);
    await screen.findByRole("article");
    fireEvent.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    vi.mocked(apiFetch).mockResolvedValue(payload([row({ contracts: 2, fingerprint: "b".repeat(24) })]));
    fireEvent.click(screen.getByRole("button", { name: "Refresh plans" }));
    await screen.findByText(/2 contracts/, { selector: "p" });
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(JSON.parse(localStorage.getItem("secretOptions.ocoEntered.v1")!)["a".repeat(24)]).toBeTruthy();
  });

  it("shows clipboard failures and clears prior references while a refresh fails", async () => {
    clipboard.mockRejectedValueOnce(new Error("denied"));
    render(<OcoExitPlans onClose={vi.fn()} />);
    await screen.findByRole("article");
    fireEvent.click(screen.getByRole("button", { name: "Copy plan reference" }));
    await screen.findByRole("alert");
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("Offline"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh plans" })));
    expect(screen.getByRole("alert").textContent).toContain("Offline");
    expect(screen.queryByRole("article")).toBeNull();
  });
});
