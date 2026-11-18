import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initializeAnalytics } from "./utils/analytics";
import { captureWsbUnlock } from "./utils/wsbAccess";

captureWsbUnlock();
window.addEventListener("popstate", captureWsbUnlock, true);
window.addEventListener("hashchange", captureWsbUnlock, true);
// Initialize Google Analytics
initializeAnalytics();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
