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
import { PRODUCT_DESCRIPTOR, PRODUCT_NAME } from "./productIdentity";

const MOBILE_NAV_ID = "topbar-mobile-navigation";
const TOOLS_NAV_ID = "topbar-tools-navigation";

export default function Topbar() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const mobileButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileNavRef = useRef<HTMLElement | null>(null);
  const toolsButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolsDisclosureRef = useRef<HTMLDivElement | null>(null);
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);
  const toolItemRefs = useRef<Array<HTMLAnchorElement | null>>([]);

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
  }, [location.pathname]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (toolsOpen && !toolsDisclosureRef.current?.contains(target)) {
        setToolsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (toolsOpen) {
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
  }, [mobileMenuOpen, toolsOpen]);

  function focusToolItem(index: number) {
    toolItemRefs.current[index]?.focus();
  }

  function openToolsMenu(focusIndex?: number) {
    setMobileMenuOpen(false);
    setToolsOpen(true);
    if (focusIndex === undefined) return;
    window.requestAnimationFrame(() => focusToolItem(focusIndex));
  }

  function toggleToolsMenu() {
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

  function toggleMobileMenu() {
    setToolsOpen(false);
    setMobileMenuOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        window.requestAnimationFrame(() => {
          const firstLink =
            mobileNavRef.current?.querySelector<HTMLAnchorElement>("a");
          firstLink?.focus();
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
