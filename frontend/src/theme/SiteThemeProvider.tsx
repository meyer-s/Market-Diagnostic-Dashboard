import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type SiteThemeId = "evidence" | "ledger" | "observatory";

export type SiteThemeDefinition = {
  readonly id: SiteThemeId;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly swatch: string;
};

export const SITE_THEMES: readonly SiteThemeDefinition[] = [
  {
    id: "evidence",
    label: "Evidence Field",
    shortLabel: "Field",
    description: "Cool evidence-led navy with restrained sea-glass accents.",
    swatch: "linear-gradient(135deg, #0e1520 0%, #182333 62%, #83bfff 100%)",
  },
  {
    id: "ledger",
    label: "Midnight Ledger",
    shortLabel: "Ledger",
    description: "Matte institutional navy with crisp steel-blue evidence marks.",
    swatch: "linear-gradient(135deg, #0a1420 0%, #162331 62%, #76a7c8 100%)",
  },
  {
    id: "observatory",
    label: "Signal Observatory",
    shortLabel: "Signal",
    description: "Deep blue-black instruments with crisp cyan signal accents.",
    swatch: "linear-gradient(135deg, #071619 0%, #0e272d 62%, #68c4d8 100%)",
  },
] as const;

export const SITE_THEME_STORAGE_KEY = "market-diagnostic.theme-preview";

const DEFAULT_SITE_THEME: SiteThemeId = "evidence";

const THEME_COLOR_BY_ID: Record<SiteThemeId, string> = {
  evidence: "#0e1520",
  ledger: "#0a1420",
  observatory: "#071619",
};

type SiteThemeContextValue = {
  theme: SiteThemeId;
  activeTheme: SiteThemeDefinition;
  setTheme: (theme: SiteThemeId) => void;
};

const SiteThemeContext = createContext<SiteThemeContextValue | null>(null);

export function isSiteThemeId(value: unknown): value is SiteThemeId {
  return (
    typeof value === "string" &&
    SITE_THEMES.some((theme) => theme.id === value)
  );
}

function findTheme(themeId: SiteThemeId): SiteThemeDefinition {
  return SITE_THEMES.find((theme) => theme.id === themeId) ?? SITE_THEMES[0];
}

function readStoredTheme(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SITE_THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readInitialTheme(): SiteThemeId {
  const storedTheme = readStoredTheme();
  if (isSiteThemeId(storedTheme)) return storedTheme;

  if (typeof document !== "undefined") {
    const appliedTheme = document.documentElement.dataset.theme;
    if (isSiteThemeId(appliedTheme)) return appliedTheme;
  }

  return DEFAULT_SITE_THEME;
}

function applyThemeToDocument(theme: SiteThemeId) {
  if (typeof document === "undefined") return;

  document.documentElement.dataset.theme = theme;

  let themeColorMeta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (!themeColorMeta) {
    themeColorMeta = document.createElement("meta");
    themeColorMeta.name = "theme-color";
    document.head.appendChild(themeColorMeta);
  }
  themeColorMeta.content = THEME_COLOR_BY_ID[theme];
}

function persistTheme(theme: SiteThemeId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SITE_THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable in private or restricted browsing contexts.
  }
}

export function SiteThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<SiteThemeId>(readInitialTheme);

  const setTheme = useCallback((nextTheme: SiteThemeId) => {
    setThemeState(nextTheme);
  }, []);

  useLayoutEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== SITE_THEME_STORAGE_KEY && event.key !== null) return;
      setThemeState(
        isSiteThemeId(event.newValue) ? event.newValue : DEFAULT_SITE_THEME,
      );
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const activeTheme = useMemo(() => findTheme(theme), [theme]);
  const value = useMemo(
    () => ({ theme, activeTheme, setTheme }),
    [activeTheme, setTheme, theme],
  );

  return (
    <SiteThemeContext.Provider value={value}>
      {children}
    </SiteThemeContext.Provider>
  );
}

export function useSiteTheme(): SiteThemeContextValue {
  const context = useContext(SiteThemeContext);
  if (!context) {
    throw new Error("useSiteTheme must be used within a SiteThemeProvider.");
  }
  return context;
}
