import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PortalLogin from "./pages/PortalLogin";
import "./index.css";
import "./lib/envTheme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PortalLogin />
  </StrictMode>,
);
