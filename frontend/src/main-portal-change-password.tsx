import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PortalChangePassword from "./pages/PortalChangePassword";
import "./index.css";
import "./lib/envTheme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PortalChangePassword />
  </StrictMode>,
);
