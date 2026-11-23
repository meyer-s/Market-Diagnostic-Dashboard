import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LiveNewsPanel from "./LiveNewsPanel";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("optional raw news sources", () => {
  it("saves individual choices, refreshes compact headlines, and labels raw reports", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    let enabled: string[] = [];
    const fetchNews = vi.fn(async (path: string, options?: RequestInit) => {
      if (path === "/live-news/sources") {
        if (options?.method === "POST") {
          const form = options.body as URLSearchParams;
          enabled = form.get("reset") === "1" ? [] : form.get("ransomware") === "1" ? ["ransomware"] : [];
          return new Response(null, { status: 204 });
        }
        return Response.json({
          token: "test-token", threshold: 45, enabled,
          sources: [{ id: "ransomware", name: "Ransomware.live", label: "Unverified victim claim", description: "Alleged victims, not confirmed breaches.", url: "https://ransomware.live/" }],
        });
      }
      if (path === "/live-news/activity") return new Response(null, { status: 204 });
      return Response.json({
        updated_at: new Date().toISOString(), checked_label: "Just now", read_interval: 5,
        raw_sources: enabled, topics: { tech: "Tech" }, page: 1, pages: 1,
        total: enabled.length, first: enabled.length, last: enabled.length, sources: [], featured: [],
        articles: enabled.map(() => ({
          id: "claim", title: "Company named by group", source: "Ransomware.live", url: "https://ransomware.live/claim",
          published_at: new Date().toISOString(), topic: "tech", priority: "High", score: 40,
          reasons: [], summary: "", cached: false, report_label: "Unverified victim claim",
        })),
      });
    });
    vi.stubGlobal("fetch", fetchNews);
    render(<LiveNewsPanel compact inViewport />);
    fireEvent.click(await screen.findByRole("button", { name: "Raw / breaking · Off" }));
    const checkbox = await screen.findByRole("checkbox", { name: /Ransomware.live/ });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/site-wide alerts above 45/)).toBeTruthy();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Save sources" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("button", { name: "Raw / breaking · 1 on" })).toBeTruthy();
    expect(screen.getByText("Raw · Unverified victim claim")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Company named by group/ }).getAttribute("target")).toBe("_blank");
    const saved = fetchNews.mock.calls.find(([path, options]) => path === "/live-news/sources" && options?.method === "POST");
    expect((saved?.[1]?.body as URLSearchParams).get("token")).toBe("test-token");
    expect((saved?.[1]?.body as URLSearchParams).get("ransomware")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Raw / breaking · 1 on" }));
    await screen.findByRole("checkbox", { name: /Ransomware.live/ });
    fireEvent.click(screen.getByRole("button", { name: "Turn off raw sources" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("button", { name: "Raw / breaking · Off" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Company named by group/ })).toBeNull();
  });
});
