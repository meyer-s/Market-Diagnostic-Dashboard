import {
  useEffect,
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
type NavigationGroup = (typeof toolGroupOrder)[number];

function GroupMenu({ group, open, onOpen, onClose, onToggle }: {
  group: NavigationGroup;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onToggle: () => void;
}) {
  const { pathname } = useLocation();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const disclosureRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const items = toolRoutes.filter((route) => route.toolGroup === group);
  const label = toolGroupLabels[group];
  const menuId = `topbar-${group}-navigation`;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!disclosureRef.current?.contains(event.target as Node)) onClose();
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      onClose();
      buttonRef.current?.focus();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  function handleButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    onOpen();
    const index = event.key === "ArrowUp" ? items.length - 1 : 0;
    window.requestAnimationFrame(() => itemRefs.current[index]?.focus());
  }

  function handleItemKeyDown(event: ReactKeyboardEvent<HTMLAnchorElement>) {
    const currentIndex = itemRefs.current.findIndex((item) => item === document.activeElement);
    let nextIndex: number;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else return;
    event.preventDefault();
    itemRefs.current[nextIndex]?.focus();
  }

  return (
    <div
      ref={disclosureRef}
      className="topbar-tools-disclosure"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        onKeyDown={handleButtonKeyDown}
        className="topbar-nav-link topbar-tools-button"
        data-active={items.some((item) => isRouteActive(pathname, item)) ? "true" : "false"}
        aria-expanded={open}
        aria-controls={menuId}
      >
        <span>{label}</span>
        <svg className="topbar-chevron" data-open={open ? "true" : "false"} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open ? (
        <div className="topbar-tools-popover">
          <nav id={menuId} className="topbar-tools-panel" aria-label={label}>
            {items.map((item, index) => {
              const isActive = isRouteActive(pathname, item);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  ref={(node) => { itemRefs.current[index] = node; }}
                  onKeyDown={handleItemKeyDown}
                  aria-current={isActive ? "page" : undefined}
                  className="topbar-tools-link"
                  data-active={isActive ? "true" : "false"}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      ) : null}
    </div>
  );
}

export default function Topbar() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<NavigationGroup | null>(null);
  const mobileButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileNavRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMobileMenuOpen(false);
    setOpenGroup(null);
  }, [location.pathname]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !mobileMenuOpen) return;
      setMobileMenuOpen(false);
      mobileButtonRef.current?.focus();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [mobileMenuOpen]);

  function toggleMobileMenu() {
    setOpenGroup(null);
    setMobileMenuOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        window.requestAnimationFrame(() => {
          mobileNavRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
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
              <Link key={item.path} to={item.path} aria-current={isActive ? "page" : undefined} className="topbar-nav-link" data-active={isActive ? "true" : "false"}>
                {item.label}
              </Link>
            );
          })}
          {toolGroupOrder.map((group) => (
            <GroupMenu
              key={group}
              group={group}
              open={openGroup === group}
              onOpen={() => { setMobileMenuOpen(false); setOpenGroup(group); }}
              onClose={() => setOpenGroup((current) => current === group ? null : current)}
              onToggle={() => { setMobileMenuOpen(false); setOpenGroup((current) => current === group ? null : group); }}
            />
          ))}
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
