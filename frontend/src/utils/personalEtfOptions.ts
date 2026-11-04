import directory from "../data/etfDirectory.json";

// Nasdaq Trader ETF=Y, Test Issue=N. Keep the source timestamp with the snapshot.
const etfSymbols = new Set(directory.symbols);
export const PERSONAL_ETF_PREFERENCE_KEY = "secret-options.show-personal-etfs";

export function isPersonalEtfOption(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  // Adjusted OCC roots (for example ETHA1) retain the underlying fund identity.
  return etfSymbols.has(normalized) || etfSymbols.has(normalized.replace(/\d+$/, ""));
}

export function readPersonalEtfPreference(): boolean {
  try {
    return localStorage.getItem(PERSONAL_ETF_PREFERENCE_KEY) === "true";
  } catch {
    return false;
  }
}

export function savePersonalEtfPreference(include: boolean): void {
  try {
    localStorage.setItem(PERSONAL_ETF_PREFERENCE_KEY, String(include));
  } catch {
    // The current view still works when browser storage is unavailable.
  }
}
