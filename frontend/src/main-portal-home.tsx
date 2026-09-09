import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PortalHome from "./pages/PortalHome";
import "./index.css";
import "./lib/envTheme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PortalHome />
  </StrictMode>,
);
