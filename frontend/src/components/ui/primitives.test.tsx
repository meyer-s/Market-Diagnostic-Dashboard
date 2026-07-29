import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AccessibleChartFrame from "./AccessibleChartFrame";
import FormField from "./FormField";
import PageState, { type PageStateVariant } from "./PageState";
import SectionNav from "./SectionNav";
import SegmentedControl from "./SegmentedControl";

describe("shared interface primitives", () => {
  afterEach(cleanup);

  it("gives charts a name, interpretation, and discoverable data alternative", () => {
    render(
      <AccessibleChartFrame
        title="Yield curve"
        description="Treasury yields by maturity."
        summary="The curve remains inverted at the front end."
        dataLabel="Yield curve source data"
        dataTable={<table><tbody><tr><td>2 year</td><td>4.2%</td></tr></tbody></table>}
      >
        <div aria-label="Yield curve visualization" />
      </AccessibleChartFrame>,
    );

    const title = screen.getByRole("heading", { name: "Yield curve" });
    const figure = title.closest("figure");
    expect(figure?.getAttribute("aria-labelledby")).toBe(title.id);
    expect(screen.getByText("The curve remains inverted at the front end.")).not.toBeNull();

    fireEvent.click(screen.getByText("View chart data"));
    expect(
      screen.getByRole("region", { name: "Yield curve source data" }),
    ).not.toBeNull();
  });

  it("connects form labels, guidance, and validation errors", () => {
    render(
      <FormField
        label="Ticker"
        hint="Use a US-listed symbol."
        error="Ticker is required."
        required
      >
        <input />
      </FormField>,
    );

    const input = screen.getByLabelText(/Ticker/);
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.hasAttribute("required")).toBe(true);
    expect(describedBy).toContain("-hint");
    expect(describedBy).toContain("-error");
    expect(screen.getByRole("alert").textContent).toBe("Ticker is required.");
  });

  it("exposes segmented selection as pressed state", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Time range"
        value="1m"
        options={[
          { value: "1m", label: "1 month" },
          { value: "1y", label: "1 year" },
        ]}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("button", { name: "1 month" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "1 year" }));
    expect(onChange).toHaveBeenCalledWith("1y");
  });

  it("provides a named in-page return path for long research views", () => {
    render(
      <SectionNav
        id="research-sections"
        label="Research sections"
        items={[
          { id: "now", label: "Now" },
          { id: "evidence", label: "Evidence" },
        ]}
      />,
    );

    const navigation = screen.getByRole("navigation", { name: "Research sections" });
    expect(navigation.id).toBe("research-sections");
    const scrollRegion = screen.getByRole("region", { name: "Research sections links" });
    expect(scrollRegion.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("link", { name: "Now" }).getAttribute("href")).toBe("#now");
    expect(screen.getByRole("link", { name: "Evidence" }).getAttribute("href")).toBe("#evidence");
  });

  it("covers every response-state class with the intended live-region semantics", () => {
    const variants: PageStateVariant[] = [
      "loading",
      "error",
      "empty",
      "partial",
      "stale",
      "protected",
    ];

    for (const variant of variants) {
      const role = variant === "error" ? "alert" : "status";
      const live = variant === "error" ? "assertive" : "polite";
      const { unmount } = render(
        <PageState
          variant={variant}
          title={`${variant} state`}
          message={`Current evidence is ${variant}.`}
        />,
      );
      const region = screen.getByRole(role);
      expect(region.classList.contains(`page-state-${variant}`)).toBe(true);
      expect(region.getAttribute("aria-live")).toBe(live);
      expect(region.getAttribute("aria-atomic")).toBe("true");
      expect(
        screen.getByRole("heading", { level: 2, name: `${variant} state` }),
      ).not.toBeNull();
      unmount();
    }
  });
});
