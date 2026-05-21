import { afterEach, describe, expect, it, vi } from "vitest";

import { checkApiHealth } from "../apiUtils";

describe("apiUtils", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("checks the real health endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: () => "application/json",
      },
      json: async () => ({ status: "ok" }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkApiHealth()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/health/"), undefined);
  });
});
