import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Login from "./pages/Login";
import "./index.css";
import "./lib/envTheme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Login />
  </StrictMode>,
);
