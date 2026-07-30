import {
  createContext,
  useContext,
  useLayoutEffect,
  type ReactNode,
} from "react";

export type SiteThemeId = "evidence";

export const SITE_THEME_STORAGE_KEY = "market-diagnostic.theme-preview";

const SITE_THEME: SiteThemeId = "evidence";
const SITE_THEME_COLOR = "#0e1520";

type SiteThemeContextValue = {
  theme: SiteThemeId;
};

const SITE_THEME_VALUE: SiteThemeContextValue = { theme: SITE_THEME };
const SiteThemeContext = createContext<SiteThemeContextValue | null>(null);

function applyEvidenceTheme() {
  if (typeof document === "undefined") return;

  document.documentElement.dataset.theme = SITE_THEME;

  let themeColorMeta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (!themeColorMeta) {
    themeColorMeta = document.createElement("meta");
    themeColorMeta.name = "theme-color";
    document.head.appendChild(themeColorMeta);
  }
  themeColorMeta.content = SITE_THEME_COLOR;

  try {
    window.localStorage.setItem(SITE_THEME_STORAGE_KEY, SITE_THEME);
  } catch {
    // Storage can be unavailable in private or restricted browsing contexts.
  }
}

export function SiteThemeProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    applyEvidenceTheme();
  }, []);

  return (
    <SiteThemeContext.Provider value={SITE_THEME_VALUE}>
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
