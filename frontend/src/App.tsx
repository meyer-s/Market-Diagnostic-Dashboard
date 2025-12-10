import { BrowserRouter, Routes, Route } from "react-router-dom";
import Sidebar from "./components/layout/Sidebar";
import Topbar from "./components/layout/Topbar";
import Dashboard from "./pages/Dashboard";
import Indicators from "./pages/Indicators";
import Alerts from "./pages/Alerts";
import IndicatorDetail from "./pages/IndicatorDetail";

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex">
        <Sidebar />
        <div className="flex-1 bg-stealth-900 min-h-screen">
          <Topbar />

          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/indicators" element={<Indicators />} />
            <Route path="/indicators/:code" element={<IndicatorDetail />} />
            <Route path="/alerts" element={<Alerts />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}