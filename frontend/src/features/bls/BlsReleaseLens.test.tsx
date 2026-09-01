import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { blsLensFixture } from "./__fixtures__/blsLensFixture";
import BlsReleaseLens from "./BlsReleaseLens";
import { densifyMonthlyPrimaryRows } from "./NativeTrend";

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

describe("BlsReleaseLens", () => {
  afterEach(cleanup);

  beforeEach(() => {
    useApiMock.mockReturnValue({
      data: blsLensFixture,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("renders one coherent visible evidence spine with three explicit clocks", async () => {
    render(<MemoryRouter><BlsReleaseLens /></MemoryRouter>);

    expect(screen.getByRole("heading", { level: 1, name: "BLS Release Lens" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Current release ledger" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Relative Field" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Native trend explorer" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Official payroll revision ledger" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Release schedule rail" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Definitions, coverage, and source IDs" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Observation vintage and footnote exceptions" })).not.toBeNull();

    expect(screen.getAllByText(/Observation clock · reference period/).length).toBeGreaterThan(0);
    expect(screen.getByText("Revision clock · estimate vintage")).not.toBeNull();
    expect(screen.getByText("Schedule clock · scheduled U.S. Eastern")).not.toBeNull();
    expect(screen.getByText(/Higher and lower describe relative position, not better and worse/)).not.toBeNull();
    expect(screen.getByText("-41")).not.toBeNull();
    expect(screen.getAllByText("8:30 AM ET").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "Raw published value" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "Observed revision" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "BLS footnotes" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Third estimate").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Second estimate").length).toBeGreaterThan(0);
    expect(screen.getByText(/annual benchmark revision process/)).not.toBeNull();

    const nowSection = document.querySelector("#bls-now");
    const calendarSection = document.querySelector("#bls-calendar");
    const revisionSection = document.querySelector("#bls-revisions");
    expect(nowSection).not.toBeNull();
    expect(calendarSection).not.toBeNull();
    expect(revisionSection).not.toBeNull();
    expect(within(nowSection as HTMLElement).queryByText(/published|recently published/i)).toBeNull();
    expect(within(calendarSection as HTMLElement).queryByText(/published|recently published/i)).toBeNull();
    expect(within(revisionSection as HTMLElement).queryByText(/\bfinal\b/i)).toBeNull();

    const revisionTable = screen.getByRole("region", { name: "Exact official payroll revision values" });
    within(revisionTable).getAllByRole("cell", { name: "Unavailable" }).forEach((cell) => {
      expect(cell.className).not.toContain("bls-positive");
      expect(cell.className).not.toContain("bls-negative");
    });

    await waitFor(() => {
      expect(screen.getByText("5 of 5 series shown")).not.toBeNull();
    });
    const endpoints = screen.getByRole("group", { name: "Selected series coverage endpoints" });
    expect(within(endpoints).getByText("Headline CPI")).not.toBeNull();
    const openingsEndpoint = within(endpoints).getByText("Openings rate").closest("div");
    expect(openingsEndpoint).not.toBeNull();
    expect(within(openingsEndpoint as HTMLElement).getByText("Jun 2026")).not.toBeNull();
    expect(within(endpoints).getByText(/endpoints differ/)).not.toBeNull();
    expect(screen.getByText(/Latest period among selected series:/)).not.toBeNull();
    expect(screen.getAllByText("CUUR0000SA0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CUUR0000SA0L1E").length).toBeGreaterThan(0);
    expect(screen.getAllByText("WPUFD4").length).toBeGreaterThan(0);
    expect(document.body.textContent?.toLowerCase()).not.toContain("market consensus");
    expect(document.body.textContent?.toLowerCase()).not.toContain("price reaction");
  });

  it("enforces the five-series comparison limit and keeps identity explicit", async () => {
    render(<MemoryRouter><BlsReleaseLens /></MemoryRouter>);

    const selector = screen.getByRole("group", { name: "Relative Field series; choose up to five" });
    const ppi = within(selector).getByRole("button", { name: /Final-demand PPI/ });
    const core = within(selector).getByRole("button", { name: /Core CPI/ });

    await waitFor(() => expect(ppi).toHaveProperty("disabled", true));
    expect(core.getAttribute("aria-pressed")).toBe("true");
    const initialPatterns = within(selector).getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.querySelector("line")?.getAttribute("stroke-dasharray") ?? "solid");
    expect(new Set(initialPatterns).size).toBe(5);

    fireEvent.click(core);
    expect(ppi).toHaveProperty("disabled", false);
    expect(screen.getByText("4 of 5 series shown")).not.toBeNull();

    fireEvent.click(ppi);
    expect(ppi.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("5 of 5 series shown")).not.toBeNull();
  });

  it("switches the native-unit series without hiding the other sections", () => {
    render(<MemoryRouter><BlsReleaseLens /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText("Series"), { target: { value: "JTS000000000000000JOR" } });

    expect(screen.getByText(/Job openings rate in its published analytical unit/)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Release schedule rail" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Official payroll revision ledger" })).not.toBeNull();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
  });

  it("uses the backend 1-month change unit instead of the raw series unit", () => {
    render(<MemoryRouter><BlsReleaseLens /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText("Series"), { target: { value: "LNS14000000" } });

    const table = screen.getByRole("region", { name: "Unemployment native values table" });
    expect(within(table).getAllByRole("cell", { name: "+0.1 percentage points" }).length).toBeGreaterThan(0);
    expect(within(table).queryByRole("cell", { name: "+0.1 % of labor force" })).toBeNull();
  });

  it("disables unavailable series and defaults both explorers to usable data", async () => {
    const partialFixture = structuredClone(blsLensFixture);
    const unavailable = partialFixture.series.find((series) => series.series_id === "CUUR0000SA0");
    if (!unavailable) throw new Error("Fixture headline CPI series is missing");
    unavailable.observations = unavailable.observations.map((observation) => ({
      ...observation,
      primary_value: null,
      relative_percentile: null,
      available: false,
      unavailable_reason: "The upstream response omitted this value.",
    }));

    useApiMock.mockReturnValue({
      data: partialFixture,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<MemoryRouter><BlsReleaseLens /></MemoryRouter>);

    const selector = screen.getByRole("group", { name: "Relative Field series; choose up to five" });
    const unavailableButton = within(selector).getByRole("button", { name: /Headline CPI Unavailable/ });
    await waitFor(() => expect(unavailableButton).toHaveProperty("disabled", true));
    expect(unavailableButton.getAttribute("aria-pressed")).toBe("false");
    expect(unavailableButton.getAttribute("title")).toContain("No primary observations");

    const nativeSelect = screen.getByLabelText("Series") as HTMLSelectElement;
    await waitFor(() => expect(nativeSelect.value).not.toBe("CUUR0000SA0"));
    const unavailableOption = screen.getByRole("option", { name: "Headline CPI — unavailable" }) as HTMLOptionElement;
    expect(unavailableOption.disabled).toBe(true);
    expect(screen.getByText("5 of 5 series shown")).not.toBeNull();
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

  it("keeps the page identity while reporting an unavailable response", () => {
    useApiMock.mockReturnValue({ data: null, loading: false, error: "The service is temporarily unavailable.", refetch: vi.fn() });
    render(<MemoryRouter><BlsReleaseLens /></MemoryRouter>);

    expect(screen.getByRole("heading", { level: 1, name: "BLS Release Lens" })).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("BLS evidence is unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).not.toBeNull();
  });
});
