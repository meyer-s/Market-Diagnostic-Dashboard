import { Link, useLocation } from "react-router-dom";
import { useState } from "react";

export default function Topbar() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  const navItems = [
    { path: "/", label: "Dashboard" },
    { path: "/vision", label: "Vision" },
    { path: "/indicators", label: "Indicators" },
    { path: "/system-breakdown", label: "System Breakdown" },
  ];

  const toolsItems = [
    { path: "/tools/recap", label: "Recap" },
    { path: "/market-map", label: "Market Map" },
    { path: "/sector-projections", label: "Sector Projections" },
    { path: "/institutional-flow", label: "Institutional Flow" },
    { path: "/stock-analysis", label: "Stock Analysis" },
    { path: "/alternative-assets", label: "Alternative Assets" },
    { path: "/news", label: "News" },
  ];

  const isToolsActive = toolsItems.some((item) => location.pathname === item.path);

  return (
    <div className="sticky top-0 z-50 w-full border-b border-stealth-700/80 bg-stealth-950/78 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
        <div className="mr-2 min-w-0">
          <span className="block truncate text-base font-semibold tracking-[0.04em] text-white md:text-lg">Market Stability Diagnostic</span>
          <span className="hidden text-[10px] uppercase tracking-[0.24em] text-stealth-500 md:block">Macro Context Engine</span>
        </div>
        
        {/* Desktop Navigation */}
        <nav className="hidden lg:flex gap-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  isActive
                    ? "border border-stealth-600 bg-stealth-800 text-white shadow-[0_0_0_1px_rgba(148,163,184,0.08)]"
                    : "text-stealth-300 hover:bg-stealth-800/90 hover:text-stealth-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <div
            className="relative"
            onMouseEnter={() => setToolsOpen(true)}
            onMouseLeave={() => setToolsOpen(false)}
          >
            <button
              type="button"
              onClick={() => setToolsOpen((prev) => !prev)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                isToolsActive
                  ? "border border-stealth-600 bg-stealth-800 text-white shadow-[0_0_0_1px_rgba(148,163,184,0.08)]"
                  : "text-stealth-300 hover:bg-stealth-800/90 hover:text-stealth-100"
              }`}
              aria-haspopup="true"
              aria-expanded={toolsOpen}
            >
              Tools
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
              <div className="absolute right-0 top-full pt-2">
                <div className="w-56 overflow-hidden rounded-2xl border border-stealth-700 bg-stealth-900/95 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.95)] backdrop-blur-xl">
                  {toolsItems.map((item) => {
                    const isActive = location.pathname === item.path;
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setToolsOpen(false)}
                        className={`block px-4 py-2.5 text-sm transition-colors ${
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
              </div>
            )}
          </div>
        </nav>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="rounded-full p-2 text-stealth-300 transition-colors hover:bg-stealth-800 hover:text-stealth-100 lg:hidden"
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
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
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
          {toolsItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileMenuOpen(false)}
                className={`block border-b border-stealth-700 px-6 py-3 text-sm font-medium transition-colors last:border-b-0 ${
                  isActive
                    ? "bg-stealth-800 text-white"
                    : "text-stealth-300 hover:bg-stealth-800 hover:text-stealth-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
