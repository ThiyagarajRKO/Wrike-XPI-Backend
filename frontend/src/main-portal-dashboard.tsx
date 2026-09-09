import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PortalDashboard from "./pages/PortalDashboard";
import "./index.css";
import "./lib/envTheme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PortalDashboard />
  </StrictMode>,
);
