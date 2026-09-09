import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import RootLogin from "./pages/RootLogin";
import "./index.css";
import "./lib/envTheme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootLogin />
  </StrictMode>,
);
