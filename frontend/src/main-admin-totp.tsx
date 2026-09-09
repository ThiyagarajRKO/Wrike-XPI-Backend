import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminTotp from "./pages/AdminTotp";
import "./index.css";
import "./lib/envTheme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AdminTotp />
  </StrictMode>,
);
