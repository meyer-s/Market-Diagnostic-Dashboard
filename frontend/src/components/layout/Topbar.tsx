import { Link, useLocation } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { isRouteActive, navRoutes, toolRoutes, toolGroupOrder, toolGroupLabels } from "../../routes/registry";

export default function Topbar() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);
  const toolItemRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  const isToolsActive = useMemo(
    () => toolRoutes.some((item) => isRouteActive(location.pathname, item)),
    [location.pathname]
  );

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!toolsOpen) return;
      const target = event.target as Node;
      if (
        toolsMenuRef.current?.contains(target) ||
        toolsButtonRef.current?.contains(target)
      ) {
        return;
      }
      setToolsOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setToolsOpen(false);
      toolsButtonRef.current?.focus();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [toolsOpen]);

  function focusToolItem(index: number) {
    toolItemRefs.current[index]?.focus();
  }

  function openToolsMenu(focusIndex = 0) {
    setToolsOpen(true);
    requestAnimationFrame(() => focusToolItem(focusIndex));
  }

  function handleToolsButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      openToolsMenu(0);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      openToolsMenu(toolRoutes.length - 1);
    }
  }

  function handleToolsMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const currentIndex = toolItemRefs.current.findIndex((item) => item === document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setToolsOpen(false);
      toolsButtonRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusToolItem((currentIndex + 1 + toolRoutes.length) % toolRoutes.length);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusToolItem((currentIndex - 1 + toolRoutes.length) % toolRoutes.length);
    }
  }

  return (
    <div className="sticky top-0 z-[200] isolate w-full border-b border-stealth-700/80 bg-stealth-950/78 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
        <div className="mr-2 min-w-0">
          <span className="block truncate text-base font-semibold tracking-[0.04em] text-white md:text-lg">Market Diagnostic Tool</span>
          <span className="hidden text-[10px] uppercase tracking-[0.24em] text-stealth-500 md:block">Macro Context Engine</span>
        </div>
        
        {/* Desktop Navigation */}
        <nav className="hidden lg:flex gap-1">
          {navRoutes.map((item) => {
            const isActive = isRouteActive(location.pathname, item);
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  isActive
                    ? "border border-stealth-600 bg-stealth-800 text-white shadow-[0_0_0_1px_rgba(148,163,184,0.08)]"
                    : "border border-transparent text-stealth-300 hover:border-sky-300/85 hover:bg-stealth-800/90 hover:text-stealth-100 hover:shadow-[0_0_0_1px_rgba(147,197,253,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70"
                }`}
              >
                <span className="relative top-px">{item.label}</span>
              </Link>
            );
          })}
          <div
            className="relative z-[210]"
            onMouseEnter={() => setToolsOpen(true)}
            onMouseLeave={() => setToolsOpen(false)}
          >
            <button
              ref={toolsButtonRef}
              type="button"
              onClick={() => setToolsOpen((prev) => !prev)}
              onKeyDown={handleToolsButtonKeyDown}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                isToolsActive
                  ? "border border-stealth-600 bg-stealth-800 text-white shadow-[0_0_0_1px_rgba(148,163,184,0.08)]"
                  : "border border-transparent text-stealth-300 hover:border-sky-300/85 hover:bg-stealth-800/90 hover:text-stealth-100 hover:shadow-[0_0_0_1px_rgba(147,197,253,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70"
              }`}
              aria-haspopup="true"
              aria-expanded={toolsOpen}
              aria-controls="topbar-tools-menu"
            >
              <span className="relative top-px">Tools</span>
              <svg
                className={`w-4 h-4 transition-transform ${toolsOpen ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {toolsOpen && (
              <div className="absolute right-0 top-full z-[220] pt-2">
                <div
                  id="topbar-tools-menu"
                  ref={toolsMenuRef}
                  onKeyDown={handleToolsMenuKeyDown}
                  className="w-56 overflow-hidden rounded-2xl border border-stealth-700 bg-stealth-900/95 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.95)] backdrop-blur-xl pb-1.5"
                >
                  {toolGroupOrder.map((group, groupIdx) => {
                    const groupItems = toolRoutes.filter((r) => r.toolGroup === group);
                    if (groupItems.length === 0) return null;
                    return (
                      <div key={group}>
                        {groupIdx > 0 && <div className="mx-3 my-1 border-t border-stealth-700/60" />}
                        <div className="px-4 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-[0.2em] text-stealth-500">
                          {toolGroupLabels[group]}
                        </div>
                        {groupItems.map((item) => {
                          const itemIndex = toolRoutes.indexOf(item);
                          const isActive = isRouteActive(location.pathname, item);
                          return (
                            <Link
                              key={item.path}
                              to={item.path}
                              ref={(node) => {
                                toolItemRefs.current[itemIndex] = node;
                              }}
                              aria-current={isActive ? "page" : undefined}
                              onClick={() => setToolsOpen(false)}
                              className={`block px-4 py-2 text-sm transition-colors ${
                                isActive
                                  ? "bg-stealth-800 text-white"
                                  : "text-stealth-300 hover:bg-stealth-800 hover:text-stealth-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300/70"
                              }`}
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
            )}
          </div>
        </nav>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="rounded-full p-2 text-stealth-300 transition-colors hover:bg-stealth-800 hover:text-stealth-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70 lg:hidden"
          aria-label="Toggle menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {mobileMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile Navigation Dropdown */}
      {mobileMenuOpen && (
        <nav className="border-t border-stealth-700 bg-stealth-900/96 backdrop-blur-xl lg:hidden">
          {navRoutes.map((item) => {
            const isActive = isRouteActive(location.pathname, item);
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setMobileMenuOpen(false)}
                className={`block border-b border-stealth-700 px-4 py-3 text-sm font-medium transition-colors last:border-b-0 ${
                  isActive
                    ? "bg-stealth-800 text-white"
                    : "text-stealth-300 hover:bg-stealth-800 hover:text-stealth-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="border-b border-stealth-700 px-4 py-3 text-xs uppercase tracking-[0.22em] text-stealth-500">
            Tools
          </div>
          {toolGroupOrder.map((group, groupIdx) => {
            const groupItems = toolRoutes.filter((r) => r.toolGroup === group);
            if (groupItems.length === 0) return null;
            return (
              <div key={group}>
                <div className={`px-4 py-2 text-[10px] font-medium uppercase tracking-[0.2em] text-stealth-500 ${groupIdx > 0 ? "border-t border-stealth-700/60 pt-3" : ""}`}>
                  {toolGroupLabels[group]}
                </div>
                {groupItems.map((item) => {
                  const isActive = isRouteActive(location.pathname, item);
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`block border-b border-stealth-700 px-8 py-3 text-sm font-medium transition-colors last:border-b-0 ${
                        isActive
                          ? "bg-stealth-800 text-white"
                          : "text-stealth-300 hover:bg-stealth-800 hover:text-stealth-100"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
      )}
    </div>
  );
}
