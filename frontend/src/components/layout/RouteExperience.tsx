import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { getPageNameForPath } from "../../routes/registry";
import { buildDocumentTitle } from "./productIdentity";

export default function RouteExperience() {
  const location = useLocation();
  const [announcement, setAnnouncement] = useState("");
  const routeName = getPageNameForPath(location.pathname);

  useEffect(() => {
    document.title = buildDocumentTitle(routeName);
    setAnnouncement(`${routeName} page loaded.`);

    const frame = window.requestAnimationFrame(() => {
      const main = document.getElementById("main-content");
      main?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, routeName]);

  return (
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </span>
  );
}
