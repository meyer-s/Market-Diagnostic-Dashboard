import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import IndicatorCard from "./IndicatorCard";

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
}));

vi.mock("../../utils/apiUtils", () => ({
  apiFetch: apiFetchMock,
}));

vi.mock("./StateSparkline", () => ({
  default: () => <div aria-label="Score history" />,
}));

describe("IndicatorCard", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("bounds displayed score precision and tolerates a malformed history response", async () => {
    apiFetchMock.mockResolvedValue({ unexpected: "payload" });

    render(
      <MemoryRouter>
        <IndicatorCard
          indicator={{
            code: "BOND_MARKET_STABILITY",
            name: "Bond Market Stability",
            raw_value: 44.01567,
            score: 44.01567,
            state: "YELLOW",
            timestamp: new Date().toISOString(),
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("44.02")).not.toBeNull();
    expect(screen.getByText("Score: 44.0")).not.toBeNull();
    expect(screen.queryByText(/44\.01567/)).toBeNull();
  });
});
