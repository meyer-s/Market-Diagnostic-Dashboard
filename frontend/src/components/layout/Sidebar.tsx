import { Link } from "react-router-dom";

export default function Sidebar() {
  return (
    <div className="w-64 bg-stealth-900 text-gray-200 h-screen p-6 space-y-4">
      <h1 className="text-xl font-bold">Market Dashboard</h1>

      <nav className="flex flex-col space-y-3">
        <Link to="/" className="hover:text-accent-yellow">Dashboard</Link>
        <Link to="/indicators" className="hover:text-accent-yellow">Indicators</Link>
        <Link to="/market-map" className="hover:text-accent-yellow">Market Map</Link>
        <Link to="/news" className="hover:text-accent-yellow">News</Link>
        <Link to="/tools/recap" className="hover:text-accent-yellow">Recap</Link>
        <Link to="/sector-projections" className="hover:text-accent-yellow font-semibold">Sector Projections</Link>
        <Link to="/precious-metals" className="hover:text-accent-yellow">💎 Precious Metals</Link>
      </nav>
    </div>
  );
}
