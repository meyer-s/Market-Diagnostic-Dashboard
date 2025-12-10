import { Link } from "react-router-dom";

export default function Sidebar() {
  return (
    <div className="w-64 bg-stealth-900 text-gray-200 h-screen p-6 space-y-4">
      <h1 className="text-xl font-bold">Market Dashboard</h1>

      <nav className="flex flex-col space-y-3">
        <Link to="/" className="hover:text-accent-yellow">Dashboard</Link>
        <Link to="/indicators" className="hover:text-accent-yellow">Indicators</Link>
        <Link to="/alerts" className="hover:text-accent-yellow">Alerts</Link>
      </nav>
    </div>
  );
}