/*
  Per-environment UI signal, keyed off the server's NODE_ENV, so the
  non-production environments (LOCAL, DEVELOPMENT, UAT, ...) are instantly
  distinguishable from LIVE. Two parts:

    1. Accent-colour override (this file). One Vite build ships to every
       environment, so it cannot be baked in at build time: the environment
       name comes from GET /api/v1/app-config, and the --accent* custom
       properties are set as inline styles on <html>, which outrank the
       :root rules every page stylesheet defines.

    2. A small text badge. Pages with a sidebar render <EnvBadge /> inline in
       the brand row (see components/EnvBadge.tsx); the sidebar-less pages
       (login, TOTP, root) get the floating fallback injected here.

  LIVE (and any unrecognised value) is left completely untouched: original
  green accent, no badge.

  Imported for its side effect only, once per page, from each main-*.tsx.
*/
import { fetchAppConfig } from "./appConfig";

export interface Palette {
  accent: string;
  accentHover: string;
  accentSoft: string;
}

// Keyed by NODE_ENV, lower-cased. Add a row when a new environment name is
// introduced; anything missing here keeps the LIVE look.
const PALETTES: Record<string, Palette> = {
  local: {
    accent: "#b45309", // amber
    accentHover: "#92400e",
    accentSoft: "rgba(180, 83, 9, 0.12)",
  },
  development: {
    accent: "#6d28d9", // violet
    accentHover: "#5b21b6",
    accentSoft: "rgba(109, 40, 217, 0.12)",
  },
  uat: {
    accent: "#0369a1", // blue (in place for when UAT is introduced)
    accentHover: "#075985",
    accentSoft: "rgba(3, 105, 161, 0.12)",
  },
};

// One shared fetch of the server NODE_ENV, reused by the colour override
// here and by <EnvBadge />.
let envPromise: Promise<string> | null = null;

/** Resolved (trimmed) NODE_ENV of the running server, or "" if unavailable. */
export function getEnvironment(): Promise<string> {
  if (!envPromise) {
    envPromise = fetchAppConfig()
      .then((c) => c.environment.trim())
      .catch(() => "");
  }
  return envPromise;
}

/**
 * Palette for an environment name, or null for LIVE / anything unrecognised
 * (which keep the :root default and show no badge).
 */
export function envPalette(env: string): Palette | null {
  return PALETTES[env.trim().toLowerCase()] ?? null;
}

// Short text shown in the badge; anything not listed uses the raw env name.
const LABELS: Record<string, string> = {
  development: "Dev",
};

/** Badge label for an environment name (e.g. "DEVELOPMENT" -> "Dev"). */
export function envLabel(env: string): string {
  const name = env.trim();
  return LABELS[name.toLowerCase()] ?? name;
}

function applyPalette(palette: Palette): void {
  const s = document.documentElement.style;
  s.setProperty("--accent", palette.accent);
  s.setProperty("--accent-hover", palette.accentHover);
  s.setProperty("--accent-soft", palette.accentSoft);
}

function renderFloatingBadge(env: string): void {
  const mount = () => {
    if (document.getElementById("env-badge")) return;
    const el = document.createElement("div");
    el.id = "env-badge";
    el.textContent = envLabel(env);
    el.title = `Environment: ${env}`;
    el.style.cssText = [
      "position:fixed",
      "right:12px",
      "bottom:12px",
      "z-index:2147483000",
      "padding:4px 10px",
      "border-radius:999px",
      "background:var(--accent)",
      "color:#fff",
      "font:700 11px/1 'Inter',system-ui,-apple-system,sans-serif",
      "letter-spacing:0.08em",
      "text-transform:uppercase",
      "box-shadow:0 2px 8px rgba(0,0,0,0.25)",
      "pointer-events:none",
      "user-select:none",
    ].join(";");
    document.body.appendChild(el);
  };

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

async function initEnvTheme(): Promise<void> {
  const env = await getEnvironment();
  const palette = envPalette(env);
  if (!palette) return; // LIVE or unknown: leave the design as-is.

  applyPalette(palette);

  // React mounts synchronously at module load, well before this fetch
  // resolves, so #sidebar is already in the DOM here if the page has one.
  if (!document.querySelector("#sidebar")) renderFloatingBadge(env);
}

void initEnvTheme();
