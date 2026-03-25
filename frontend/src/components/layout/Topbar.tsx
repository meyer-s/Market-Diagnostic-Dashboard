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
    <div className="sticky top-0 z-50 w-full bg-stealth-800 border-b border-stealth-700 shadow-lg">
      <div className="flex items-center justify-between h-16 px-4 md:px-6">
        <span className="text-base md:text-lg font-bold text-stealth-100 truncate mr-2">Market Stability Diagnostic</span>
        
        {/* Desktop Navigation */}
        <nav className="hidden lg:flex gap-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-stealth-700 text-pulse-400"
                    : "text-stealth-300 hover:bg-stealth-700 hover:text-stealth-100"
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
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                isToolsActive
                  ? "bg-stealth-700 text-pulse-400"
                  : "text-stealth-300 hover:bg-stealth-700 hover:text-stealth-100"
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
                <div className="w-56 rounded-lg border border-stealth-700 bg-stealth-850 shadow-xl overflow-hidden">
                  {toolsItems.map((item) => {
                    const isActive = location.pathname === item.path;
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setToolsOpen(false)}
                        className={`block px-4 py-2 text-sm transition-colors ${
                          isActive
                            ? "bg-stealth-700 text-pulse-400"
                            : "text-stealth-300 hover:bg-stealth-700 hover:text-stealth-100"
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
          className="lg:hidden p-2 text-stealth-300 hover:text-stealth-100 hover:bg-stealth-700 rounded-lg transition-colors"
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
        <nav className="lg:hidden bg-stealth-850 border-t border-stealth-700">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileMenuOpen(false)}
                className={`block px-4 py-3 text-sm font-medium transition-colors border-b border-stealth-700 last:border-b-0 ${
                  isActive
                    ? "bg-stealth-700 text-pulse-400"
                    : "text-stealth-300 hover:bg-stealth-700 hover:text-stealth-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="px-4 py-3 text-xs uppercase tracking-wide text-stealth-500 border-b border-stealth-700">
            Tools
          </div>
          {toolsItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileMenuOpen(false)}
                className={`block px-6 py-3 text-sm font-medium transition-colors border-b border-stealth-700 last:border-b-0 ${
                  isActive
                    ? "bg-stealth-700 text-pulse-400"
                    : "text-stealth-300 hover:bg-stealth-700 hover:text-stealth-100"
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
