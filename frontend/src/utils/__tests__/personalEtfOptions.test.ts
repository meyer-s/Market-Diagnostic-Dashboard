import { afterEach, describe, expect, it, vi } from "vitest";
import { isPersonalEtfOption, PERSONAL_ETF_PREFERENCE_KEY, readPersonalEtfPreference, savePersonalEtfPreference } from "../personalEtfOptions";

afterEach(() => { vi.unstubAllGlobals(); });

describe("personal ETF options", () => {
  it("covers sector, leveraged, commodity and crypto funds, including adjusted roots", () => {
    for (const symbol of ["SPY", "TQQQ", "IBIT", "ETHA1", "GLD", "SLV", "PPLT", "DBA", "MOO", "XLC", "XLV", "XLP", "XLU", "RSP", "TLT", "IBB", "CRAK", "SOLZ"]) {
      expect(isPersonalEtfOption(symbol), symbol).toBe(true);
    }
    expect(isPersonalEtfOption("  gld ")).toBe(true);
    for (const symbol of ["META", "T", "KO", "RTX", "GM", "M", "VIX", ""]) {
      expect(isPersonalEtfOption(symbol), symbol).toBe(false);
    }
  });

  it("hides ETF bets by default and persists an explicit opt-in", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    expect(readPersonalEtfPreference()).toBe(false);
    savePersonalEtfPreference(true);
    expect(values.get(PERSONAL_ETF_PREFERENCE_KEY)).toBe("true");
    expect(readPersonalEtfPreference()).toBe(true);
    savePersonalEtfPreference(false);
    expect(readPersonalEtfPreference()).toBe(false);
  });

  it("keeps a usable default when storage is unavailable", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(readPersonalEtfPreference()).toBe(false);
    expect(() => savePersonalEtfPreference(true)).not.toThrow();
  });
});
