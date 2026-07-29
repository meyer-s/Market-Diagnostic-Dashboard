import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UpdatePostDetail } from "../../types/updates";
import UpdatesViewer from "./UpdatesViewer";

const basePost: UpdatePostDetail = {
  id: "recap-1",
  created_at: "2026-07-29T12:00:00Z",
  title: "Fixture recap",
  slug: "fixture-recap",
  summary: "A deterministic recap fixture.",
  status: "GREEN",
  tags: [],
  pinned: false,
  content_markdown: "## Market read\n\nFixture analysis.",
  chart_urls: [],
  published: true,
};

describe("UpdatesViewer chart evidence contract", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the Gallery section visible and classified when production has no chart URLs", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const { container } = render(
      <UpdatesViewer
        post={basePost}
        loading={false}
        error={null}
        onOpenChart={vi.fn()}
      />,
    );

    const gallery = container.querySelector('[data-evidence-panel="recap-gallery"]');
    expect(gallery?.getAttribute("data-evidence-state")).toBe("empty");
    expect(screen.getByText(/does not include chart snapshots/i)).not.toBeNull();
  });

  it("classifies a populated Gallery fixture and exposes its launch control", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const { container } = render(
      <UpdatesViewer
        post={{ ...basePost, chart_urls: ["https://example.com/chart.png"] }}
        loading={false}
        error={null}
        onOpenChart={vi.fn()}
      />,
    );

    const gallery = container.querySelector('[data-evidence-panel="recap-gallery"]');
    expect(gallery?.getAttribute("data-evidence-state")).toBe("complete");
    expect(screen.getByRole("button", { name: /chart 1 supporting fixture recap/i })).not.toBeNull();
  });
});
