import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Link, useLocation } from "react-router-dom";

import {
  isRouteActive,
  navRoutes,
  toolGroupLabels,
  toolGroupOrder,
  toolRoutes,
} from "../../routes/registry";
import { SITE_THEMES, useSiteTheme } from "../../theme/SiteThemeProvider";
import { PRODUCT_DESCRIPTOR, PRODUCT_NAME } from "./productIdentity";

const MOBILE_NAV_ID = "topbar-mobile-navigation";
const TOOLS_NAV_ID = "topbar-tools-navigation";
const THEME_NAV_ID = "topbar-theme-preview";

export default function Topbar() {
  const location = useLocation();
  const { theme, activeTheme, setTheme } = useSiteTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const mobileButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileNavRef = useRef<HTMLElement | null>(null);
  const toolsButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolsDisclosureRef = useRef<HTMLDivElement | null>(null);
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);
  const toolItemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const themeButtonRef = useRef<HTMLButtonElement | null>(null);
  const themeDisclosureRef = useRef<HTMLDivElement | null>(null);
  const themeItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mobileThemeItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const isToolsActive = useMemo(
    () => toolRoutes.some((item) => isRouteActive(location.pathname, item)),
    [location.pathname],
  );
  const orderedToolRoutes = useMemo(
    () => toolGroupOrder.flatMap(
      (group) => toolRoutes.filter((route) => route.toolGroup === group),
    ),
    [],
  );

  useEffect(() => {
    setMobileMenuOpen(false);
    setToolsOpen(false);
    setThemeOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (toolsOpen && !toolsDisclosureRef.current?.contains(target)) {
        setToolsOpen(false);
      }
      if (themeOpen && !themeDisclosureRef.current?.contains(target)) {
        setThemeOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (themeOpen) {
        setThemeOpen(false);
        themeButtonRef.current?.focus();
      } else if (toolsOpen) {
        setToolsOpen(false);
        toolsButtonRef.current?.focus();
      } else if (mobileMenuOpen) {
        setMobileMenuOpen(false);
        mobileButtonRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [mobileMenuOpen, themeOpen, toolsOpen]);

  function focusToolItem(index: number) {
    toolItemRefs.current[index]?.focus();
  }

  function openToolsMenu(focusIndex?: number) {
    setThemeOpen(false);
    setMobileMenuOpen(false);
    setToolsOpen(true);
    if (focusIndex === undefined) return;
    window.requestAnimationFrame(() => focusToolItem(focusIndex));
  }

  function toggleToolsMenu() {
    setThemeOpen(false);
    setMobileMenuOpen(false);
    setToolsOpen((open) => !open);
  }

  function handleToolsButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      openToolsMenu(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openToolsMenu(orderedToolRoutes.length - 1);
    }
  }

  function handleToolsMenuKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const currentIndex = toolItemRefs.current.findIndex(
      (item) => item === document.activeElement,
    );
    if (event.key === "Escape") {
      event.preventDefault();
      setToolsOpen(false);
      toolsButtonRef.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusToolItem(
        (currentIndex + 1 + orderedToolRoutes.length) % orderedToolRoutes.length,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusToolItem(
        (currentIndex - 1 + orderedToolRoutes.length) % orderedToolRoutes.length,
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      focusToolItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusToolItem(orderedToolRoutes.length - 1);
    }
  }

  function focusThemeItem(index: number) {
    themeItemRefs.current[index]?.focus();
  }

  function openThemeMenu(focusIndex?: number) {
    setToolsOpen(false);
    setMobileMenuOpen(false);
    setThemeOpen(true);
    if (focusIndex === undefined) return;
    window.requestAnimationFrame(() => focusThemeItem(focusIndex));
  }

  function closeThemeMenu({ restoreFocus = false } = {}) {
    setThemeOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => themeButtonRef.current?.focus());
    }
  }

  function toggleThemeMenu() {
    if (themeOpen) {
      closeThemeMenu();
      return;
    }
    openThemeMenu();
  }

  function handleThemeButtonKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) {
    const activeIndex = SITE_THEMES.findIndex((item) => item.id === theme);
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openThemeMenu(activeIndex);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      openThemeMenu(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openThemeMenu(SITE_THEMES.length - 1);
    }
  }

  function handleThemeMenuKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const currentIndex = themeItemRefs.current.findIndex(
      (item) => item === document.activeElement,
    );
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeThemeMenu({ restoreFocus: true });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusThemeItem((Math.max(currentIndex, -1) + 1) % SITE_THEMES.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusThemeItem(
        currentIndex <= 0 ? SITE_THEMES.length - 1 : currentIndex - 1,
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      focusThemeItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusThemeItem(SITE_THEMES.length - 1);
    }
  }

  function chooseDesktopTheme(nextTheme: (typeof SITE_THEMES)[number]["id"]) {
    setTheme(nextTheme);
    closeThemeMenu({ restoreFocus: true });
  }

  function handleMobileThemeKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % SITE_THEMES.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + SITE_THEMES.length) % SITE_THEMES.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = SITE_THEMES.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    setTheme(SITE_THEMES[nextIndex].id);
    mobileThemeItemRefs.current[nextIndex]?.focus();
  }

  function toggleMobileMenu() {
    setToolsOpen(false);
    setThemeOpen(false);
    setMobileMenuOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        window.requestAnimationFrame(() => {
          const selectedTheme =
            mobileNavRef.current?.querySelector<HTMLButtonElement>(
              '[role="radio"][aria-checked="true"]',
            );
          const fallbackLink =
            mobileNavRef.current?.querySelector<HTMLAnchorElement>("a");
          (selectedTheme ?? fallbackLink)?.focus();
        });
      }
      return nextOpen;
    });
  }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="topbar-brand" to="/" aria-label={`${PRODUCT_NAME}, dashboard`}>
          <span className="topbar-brand-copy">
            <span className="topbar-brand-name">{PRODUCT_NAME}</span>
            <span className="topbar-brand-descriptor">{PRODUCT_DESCRIPTOR}</span>
          </span>
        </Link>

        <nav className="topbar-primary-nav" aria-label="Primary">
          {navRoutes.map((item) => {
            const isActive = isRouteActive(location.pathname, item);
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={isActive ? "page" : undefined}
                className="topbar-nav-link"
                data-active={isActive ? "true" : "false"}
              >
                {item.label}
              </Link>
            );
          })}

          <div
            ref={themeDisclosureRef}
            className="topbar-theme-disclosure"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setThemeOpen(false);
              }
            }}
          >
            <button
              ref={themeButtonRef}
              type="button"
              onClick={toggleThemeMenu}
              onKeyDown={handleThemeButtonKeyDown}
              className="topbar-nav-link topbar-theme-button"
              aria-haspopup="menu"
              aria-expanded={themeOpen}
              aria-controls={THEME_NAV_ID}
            >
              <span>View</span>
              <span>{activeTheme.shortLabel}</span>
              <svg
                className="topbar-chevron"
                data-open={themeOpen ? "true" : "false"}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {themeOpen ? (
              <div className="topbar-theme-popover">
                <div
                  id={THEME_NAV_ID}
                  className="topbar-theme-panel"
                  role="menu"
                  aria-label="Preview view"
                  tabIndex={-1}
                  onKeyDown={handleThemeMenuKeyDown}
                >
                  <div className="topbar-theme-options">
                    {SITE_THEMES.map((item, index) => {
                      const isSelected = item.id === theme;
                      return (
                        <button
                          key={item.id}
                          ref={(node) => {
                            themeItemRefs.current[index] = node;
                          }}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isSelected}
                          data-selected={isSelected ? "true" : "false"}
                          data-theme-value={item.id}
                          tabIndex={isSelected ? 0 : -1}
                          className="topbar-theme-option"
                          onClick={() => chooseDesktopTheme(item.id)}
                        >
                          <span
                            className="topbar-theme-swatch topbar-theme-preview"
                            data-theme-preview={item.id}
                            aria-hidden="true"
                          >
                            <span className="topbar-theme-preview-layer topbar-theme-preview-layer-back" />
                            <span className="topbar-theme-preview-layer topbar-theme-preview-layer-front">
                              <span className="topbar-theme-preview-line topbar-theme-preview-line-primary" />
                              <span className="topbar-theme-preview-line topbar-theme-preview-line-secondary" />
                              <span className="topbar-theme-preview-line topbar-theme-preview-line-tertiary" />
                            </span>
                            <span className="topbar-theme-preview-marker" />
                          </span>
                          <span>
                            <span className="topbar-theme-name">{item.label}</span>
                            <span className="topbar-theme-description">
                              {item.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div
            ref={toolsDisclosureRef}
            className="topbar-tools-disclosure"
            onMouseEnter={() => openToolsMenu()}
            onMouseLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement)) {
                setToolsOpen(false);
              }
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setToolsOpen(false);
              }
            }}
          >
            <button
              ref={toolsButtonRef}
              type="button"
              onClick={toggleToolsMenu}
              onKeyDown={handleToolsButtonKeyDown}
              className="topbar-nav-link topbar-tools-button"
              data-active={isToolsActive ? "true" : "false"}
              aria-haspopup="true"
              aria-expanded={toolsOpen}
              aria-controls={TOOLS_NAV_ID}
            >
              <span>Tools</span>
              <svg
                className="topbar-chevron"
                data-open={toolsOpen ? "true" : "false"}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {toolsOpen ? (
              <div className="topbar-tools-popover">
                <div
                  id={TOOLS_NAV_ID}
                  ref={toolsMenuRef}
                  className="topbar-tools-panel"
                  role="navigation"
                  aria-label="Research tools"
                  tabIndex={0}
                >
                  {toolGroupOrder.map((group, groupIndex) => {
                    const groupItems = toolRoutes.filter((route) => route.toolGroup === group);
                    if (groupItems.length === 0) return null;
                    return (
                      <div className="topbar-tools-group" key={group}>
                        {groupIndex > 0 ? <div className="topbar-tools-rule" /> : null}
                        <p className="topbar-tools-label">{toolGroupLabels[group]}</p>
                        {groupItems.map((item) => {
                          const itemIndex = orderedToolRoutes.indexOf(item);
                          const isActive = isRouteActive(location.pathname, item);
                          return (
                            <Link
                              key={item.path}
                              to={item.path}
                              ref={(node) => {
                                toolItemRefs.current[itemIndex] = node;
                              }}
                              onKeyDown={handleToolsMenuKeyDown}
                              aria-current={isActive ? "page" : undefined}
                              className="topbar-tools-link"
                              data-active={isActive ? "true" : "false"}
                            >
                              {item.label}
                            </Link>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </nav>

        <button
          ref={mobileButtonRef}
          type="button"
          onClick={toggleMobileMenu}
          className="topbar-mobile-button"
          aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileMenuOpen}
          aria-controls={MOBILE_NAV_ID}
        >
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            {mobileMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {mobileMenuOpen ? (
        <nav
          id={MOBILE_NAV_ID}
          ref={mobileNavRef}
          className="topbar-mobile-nav"
          aria-label="Mobile"
          tabIndex={0}
        >
          <div className="topbar-mobile-section topbar-mobile-theme-section">
            <p className="topbar-mobile-label">Preview view</p>
            <div
              className="topbar-mobile-theme-options"
              role="radiogroup"
              aria-label="Preview view"
            >
              {SITE_THEMES.map((item, index) => {
                const isSelected = item.id === theme;
                return (
                  <button
                    key={item.id}
                    ref={(node) => {
                      mobileThemeItemRefs.current[index] = node;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    data-selected={isSelected ? "true" : "false"}
                    data-theme-value={item.id}
                    tabIndex={isSelected ? 0 : -1}
                    className="topbar-mobile-theme-option"
                    onClick={() => setTheme(item.id)}
                    onKeyDown={(event) =>
                      handleMobileThemeKeyDown(event, index)
                    }
                  >
                    <span
                      className="topbar-mobile-theme-swatch topbar-theme-preview"
                      data-theme-preview={item.id}
                      aria-hidden="true"
                    >
                      <span className="topbar-theme-preview-layer topbar-theme-preview-layer-back" />
                      <span className="topbar-theme-preview-layer topbar-theme-preview-layer-front">
                        <span className="topbar-theme-preview-line topbar-theme-preview-line-primary" />
                        <span className="topbar-theme-preview-line topbar-theme-preview-line-secondary" />
                        <span className="topbar-theme-preview-line topbar-theme-preview-line-tertiary" />
                      </span>
                      <span className="topbar-theme-preview-marker" />
                    </span>
                    <span className="topbar-mobile-theme-copy">
                      <span>{item.label}</span>
                      <span>{item.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="topbar-mobile-section">
            <p className="topbar-mobile-label">Primary</p>
            {navRoutes.map((item) => {
              const isActive = isRouteActive(location.pathname, item);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  aria-current={isActive ? "page" : undefined}
                  className="topbar-mobile-link"
                  data-active={isActive ? "true" : "false"}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          {toolGroupOrder.map((group) => {
            const groupItems = toolRoutes.filter((route) => route.toolGroup === group);
            if (groupItems.length === 0) return null;
            const isGroupActive = groupItems.some((item) =>
              isRouteActive(location.pathname, item),
            );
            return (
              <details
                className="topbar-mobile-tool-group"
                key={group}
                open={isGroupActive || undefined}
              >
                <summary className="topbar-mobile-tool-summary">
                  <span>{toolGroupLabels[group]}</span>
                  <svg
                    className="topbar-mobile-tool-chevron"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="topbar-mobile-tool-links">
                  {groupItems.map((item) => {
                    const isActive = isRouteActive(location.pathname, item);
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        aria-current={isActive ? "page" : undefined}
                        className="topbar-mobile-link"
                        data-active={isActive ? "true" : "false"}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </nav>
      ) : null}
    </header>
  );
}
