import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LiveNewsPanel from "./LiveNewsPanel";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("secondary gray news feed", () => {
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
        total: 0, first: 0, last: 0, sources: [], featured: [], articles: [],
        gray: { total: enabled.length, page: 1, pages: 1, first: enabled.length, last: enabled.length, articles: enabled.map(() => ({
          id: "claim", title: "Company named by group", source: "Ransomware.live", url: "https://ransomware.live/claim",
          published_at: new Date().toISOString(), topic: "tech", priority: "High", score: 40,
          reasons: [], summary: "", cached: false, report_label: "Unverified victim claim",
        })) },
      });
    });
    vi.stubGlobal("fetch", fetchNews);
    render(<LiveNewsPanel compact inViewport />);
    fireEvent.click(await screen.findByRole("button", { name: "Gray sources · Off" }));
    const checkbox = await screen.findByRole("checkbox", { name: /Ransomware.live/ });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/site-wide alerts above 45/)).toBeTruthy();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Save sources" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("button", { name: "Gray sources · 1 on" })).toBeTruthy();
    const grayFeed = within(screen.getByRole("complementary", { name: "Gray sources" }));
    expect(grayFeed.getByText("Gray · Unverified victim claim")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Main news feed" })).queryByText("Company named by group")).toBeNull();
    expect(screen.getByRole("link", { name: /Company named by group/ }).getAttribute("target")).toBe("_blank");
    const saved = fetchNews.mock.calls.find(([path, options]) => path === "/live-news/sources" && options?.method === "POST");
    expect((saved?.[1]?.body as URLSearchParams).get("token")).toBe("test-token");
    expect((saved?.[1]?.body as URLSearchParams).get("ransomware")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Gray sources · 1 on" }));
    await screen.findByRole("checkbox", { name: /Ransomware.live/ });
    fireEvent.click(screen.getByRole("button", { name: "Turn off gray sources" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("button", { name: "Gray sources · Off" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Company named by group/ })).toBeNull();
  });

  it("keeps the main feed mounted while paging the default-enabled gray column", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const article = (id: string, raw = false) => ({
      id, title: `Headline ${id}`, source: raw ? "RansomLook" : "Publisher", url: `https://example.com/${id}`,
      published_at: new Date().toISOString(), topic: "tech", priority: "High", score: 32,
      reasons: [], summary: "", cached: false, report_label: raw ? "Unverified victim claim" : "",
    });
    const snapshot = (page: number) => ({
      updated_at: new Date().toISOString(), checked_label: "Just now", read_interval: 5,
      raw_sources: ["zerohedge", "ransomware", "hn", "ransomlook", "darkwebinformer", "databreaches"],
      topics: { tech: "Tech" }, page: 1, pages: 1, total: 1, first: 1, last: 1,
      sources: [], featured: [], articles: [article("main")],
      gray: { page, pages: 2, total: 13, first: page === 1 ? 1 : 13, last: page === 1 ? 12 : 13,
        articles: [article(page === 1 ? "gray-first" : "gray-last", true)] },
    });
    let finishNext: (response: Response) => void = () => {};
    const fetchNews = vi.fn(async (path: string) => {
      if (path.includes("gray_page=2")) return new Promise<Response>((resolve) => { finishNext = resolve; });
      return Response.json(snapshot(1));
    });
    vi.stubGlobal("fetch", fetchNews);
    render(<LiveNewsPanel inViewport />);
    const mainLink = await screen.findByRole("link", { name: /Headline main/ });
    expect(screen.getByRole("button", { name: "Gray sources · 6 on" })).toBeTruthy();
    const grayFeed = within(screen.getByRole("complementary", { name: "Gray sources" }));
    expect(grayFeed.getByRole("link", { name: /Headline gray-first/ })).toBeTruthy();
    fireEvent.click(grayFeed.getByRole("button", { name: "Next gray headlines" }));
    await waitFor(() => expect(fetchNews).toHaveBeenCalledWith(expect.stringContaining("page=1&gray_page=2"), expect.anything()));
    expect(screen.getByRole("link", { name: /Headline main/ })).toBe(mainLink);
    expect(screen.queryByText("Loading live headlines.")).toBeNull();
    finishNext(Response.json(snapshot(2)));
    expect(await grayFeed.findByRole("link", { name: /Headline gray-last/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Headline main/ })).toBe(mainLink);
    expect(within(screen.getByRole("region", { name: "Main news feed" })).queryByRole("link", { name: /Headline gray/ })).toBeNull();
  });
});
