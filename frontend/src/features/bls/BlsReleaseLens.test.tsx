import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { blsLensFixture } from "./__fixtures__/blsLensFixture";
import BlsReleaseLens from "./BlsReleaseLens";
import { densifyMonthlyPrimaryRows } from "./NativeTrend";
import { buildRelativeRows } from "./RelativeField";

const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));

vi.mock("../../hooks/useApi", () => ({ useApi: useApiMock }));
vi.mock("recharts", () => {
  const Shell = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Bar: Shell,
    BarChart: Shell,
    CartesianGrid: () => null,
    Cell: () => null,
    Line: ({ name }: { name?: string }) => name ? <span>{name}</span> : null,
    LineChart: Shell,
    ReferenceLine: () => null,
    ResponsiveContainer: Shell,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

function renderLens(entry = "/bls") {
  return render(<MemoryRouter initialEntries={[entry]}><BlsReleaseLens /></MemoryRouter>);
}

describe("BlsReleaseLens", () => {
  afterEach(cleanup);

  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    useApiMock.mockReturnValue({
      data: blsLensFixture,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("defaults to an answer-first Overview while keeping the five proof workspaces out of the reading flow", () => {
    renderLens();

    expect(screen.getByRole("heading", { level: 1, name: "BLS Release Lens" })).not.toBeNull();
    expect(screen.getByText(/Updated Aug 28, 2026/)).not.toBeNull();
    expect(screen.getByRole("tablist", { name: "BLS Release Lens views" })).not.toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(6);
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Labor-market overview" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Current read" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Headline observations" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "What changed?" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Next scheduled release" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Latest observations by report" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Relative comparison" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "How the evidence is built" })).toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain("initial claims");
    expect(document.body.textContent?.toLowerCase()).not.toContain("market consensus");
    expect(document.body.textContent?.toLowerCase()).not.toContain("price reaction");
  });

  it("renders exactly one active workspace and supports automatic keyboard tab activation", async () => {
    renderLens();

    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    overviewTab.focus();
    fireEvent.keyDown(overviewTab, { key: "ArrowRight" });

    await waitFor(() => expect(screen.getByRole("tab", { name: "Releases" }).getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByRole("heading", { name: "Latest observations by report" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Labor-market overview" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Revisions" }));
    expect(screen.getByRole("heading", { name: "Payroll revisions" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Latest observations by report" })).toBeNull();
    expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
    expect(document.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("bls-tab-revisions");
  });

  it("opens a direct Trends URL with the requested native series and a two-indicator comparison cap", async () => {
    renderLens("/bls?view=trends&series=WPUFD4");

    expect(screen.getByRole("tab", { name: "Trends" }).getAttribute("aria-selected")).toBe("true");
    const nativeSelect = screen.getByLabelText("Indicator") as HTMLSelectElement;
    await waitFor(() => expect(nativeSelect.value).toBe("WPUFD4"));
    expect(screen.getByRole("heading", { name: "Native trend explorer" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Relative comparison" })).not.toBeNull();
    expect(screen.getByText("Change from adjacent prior")).not.toBeNull();

    fireEvent.click(screen.getByText(/Compare indicators · 2 of 2 selected/));
    const selector = screen.getByRole("group", { name: "Relative comparison series; choose up to two" });
    expect(within(selector).getAllByRole("button")).toHaveLength(9);
    expect(within(selector).getAllByRole("button", { pressed: true })).toHaveLength(2);
    const ppi = within(selector).getByRole("button", { name: /Final-demand PPI/ });
    expect(ppi.getAttribute("aria-pressed")).toBe("true");

    const payroll = within(selector).getByRole("button", { name: /Payroll change/ });
    fireEvent.click(payroll);
    const unemployment = within(selector).getByRole("button", { name: /Unemployment/ });
    expect(unemployment).toHaveProperty("disabled", false);
    fireEvent.click(unemployment);
    expect(within(selector).getAllByRole("button", { pressed: true })).toHaveLength(2);
    expect(ppi.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("2 of 2 indicators shown")).not.toBeNull();
  });

  it("preserves indicator focus when an Overview action opens Trends", async () => {
    renderLens();

    fireEvent.click(screen.getByRole("button", { name: "Open Payroll growth in Trends" }));

    await waitFor(() => expect(screen.getByRole("tab", { name: "Trends" }).getAttribute("aria-selected")).toBe("true"));
    expect((screen.getByLabelText("Indicator") as HTMLSelectElement).value).toBe("CES0000000001");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Trends" })));
  });

  it("keeps revision, calendar, and methods evidence behind their dedicated views", () => {
    renderLens();

    fireEvent.click(screen.getByRole("tab", { name: "Revisions" }));
    expect(screen.getByText(/of the last 3 completed payroll estimates were revised downward/)).not.toBeNull();
    expect(screen.getByText("Upward revision")).not.toBeNull();
    expect(screen.getByText("Downward revision")).not.toBeNull();
    expect(screen.getAllByText("Third estimate").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Second estimate").length).toBeGreaterThan(0);
    expect(screen.queryByText(/\bfinal\b/i)).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(screen.getByRole("heading", { name: "BLS release schedule" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "What comes next" })).not.toBeNull();
    expect(screen.getAllByRole("link", { name: "Add to calendar" }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/published|recently published/i)).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Methods & sources" }));
    expect(screen.getByRole("heading", { name: "How the evidence is built" })).not.toBeNull();
    expect(screen.getByLabelText("Search glossary and source mappings")).not.toBeNull();
    expect(screen.getAllByText("Reference period").length).toBeGreaterThan(0);
    expect(screen.getByText("Official report sources")).not.toBeNull();
    fireEvent.click(screen.getByText(/Calculation rules and coverage receipt/));
    expect(screen.getByRole("heading", { name: "Dashboard labor-direction rule" })).not.toBeNull();
    expect(screen.getByText(/transparent dashboard rules, not BLS, recession, or policy classifications/i)).not.toBeNull();
  });

  it("uses the backend 1-month change unit in the detailed native data table", () => {
    renderLens("/bls?view=trends&series=LNS14000000");

    const dataDisclosure = screen.getAllByText("View chart data")[0].closest("details");
    expect(dataDisclosure).not.toBeNull();
    if (dataDisclosure) fireEvent.click(dataDisclosure.querySelector("summary") as HTMLElement);
    const nativeSummary = screen.getByLabelText("Unemployment current observation summary");
    expect(within(nativeSummary).getByText("percentage points")).not.toBeNull();
    const table = screen.getByRole("region", { name: "Unemployment native values table" });
    expect(within(table).getAllByRole("cell", { name: "+0.1 percentage points" }).length).toBeGreaterThan(0);
    expect(within(table).queryByRole("cell", { name: "+0.1 % of labor force" })).toBeNull();
  });

  it("falls back to Overview for an invalid view parameter", () => {
    renderLens("/bls?view=unknown");
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Labor-market overview" })).not.toBeNull();
  });

  it("maps legacy section hashes into the corresponding workspace", async () => {
    window.history.replaceState({}, "", "/bls#bls-revisions");
    renderLens("/bls#bls-revisions");

    await waitFor(() => expect(screen.getByRole("tab", { name: "Revisions" }).getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByRole("heading", { name: "Payroll revisions" })).not.toBeNull();
  });

  it("densifies omitted months so the native chart preserves a visible gap", () => {
    const observations = [
      blsLensFixture.series[0].observations[0],
      blsLensFixture.series[0].observations[2],
    ];

    expect(densifyMonthlyPrimaryRows(observations)).toEqual([
      { period: "2026-03-01", primary_value: 2.4 },
      { period: "2026-04-01", primary_value: null },
      { period: "2026-05-01", primary_value: 2.4 },
    ]);
  });

  it("densifies a month omitted by every selected Relative series", () => {
    const selected = structuredClone(blsLensFixture.series.slice(0, 2));
    selected.forEach((series) => {
      series.observations = series.observations.filter((observation) => observation.period !== "2026-04-01");
    });

    const gap = buildRelativeRows(selected).find((row) => row.period === "2026-04-01");
    expect(gap).toEqual({
      period: "2026-04-01",
      [selected[0].series_id]: null,
      [selected[1].series_id]: null,
    });
  });

  it("replaces unavailable trend actions with an explicit reason", () => {
    const partial = structuredClone(blsLensFixture);
    const payroll = partial.series.find((series) => series.series_id === "CES0000000001");
    if (!payroll) throw new Error("Missing payroll fixture series");
    payroll.observations = payroll.observations.map((observation) => ({
      ...observation,
      primary_value: null,
      available: false,
    }));
    useApiMock.mockReturnValue({ data: partial, loading: false, error: null, refetch: vi.fn() });

    renderLens();
    const overviewAction = screen.getByRole("button", { name: "Trend unavailable" });
    expect(overviewAction).toHaveProperty("disabled", true);
    expect(screen.getByText("No primary observations are available for this indicator.")).not.toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Releases" }));
    const payrollRow = screen.getByText("Payroll change").closest("li");
    expect(payrollRow).not.toBeNull();
    if (payrollRow) {
      expect(within(payrollRow).getByText("Trend unavailable · no primary observations")).not.toBeNull();
      expect(within(payrollRow).queryByRole("button", { name: "View trend" })).toBeNull();
    }
  });

  it("keeps the page identity while reporting an unavailable response", () => {
    useApiMock.mockReturnValue({ data: null, loading: false, error: "The service is temporarily unavailable.", refetch: vi.fn() });
    renderLens();

    expect(screen.getByRole("heading", { level: 1, name: "BLS Release Lens" })).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("BLS evidence is unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).not.toBeNull();
  });
});
