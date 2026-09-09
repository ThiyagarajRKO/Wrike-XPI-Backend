/*
  Per-environment UI signal, keyed off the server's NODE_ENV, so the
  non-production environments (LOCAL, DEVELOPMENT, UAT, ...) are instantly
  distinguishable from LIVE. Two parts:

    1. Accent-colour override (this file). One Vite build ships to every
       environment, so it cannot be baked in at build time: the environment
       name comes from GET /api/v1/app-config, and the --accent* custom
       properties are set as inline styles on <html>, which outrank the
       :root rules every page stylesheet defines.

    2. Small text tags. Pages with a sidebar render <EnvBadge /> in the brand
       row and <BuildTag /> in the footer; the sidebar-less pages (login,
       TOTP, root) get the floating equivalents injected here.

  For the accent colour, LIVE (and any unrecognised value) is left completely
  untouched: original green, no env badge. The build tag always shows.

  Imported for its side effect only, once per page, from each main-*.tsx.
*/
import { fetchAppConfig, type AppConfig } from "./appConfig";

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

// One shared GET /api/v1/app-config for the whole page, reused by the accent
// override here, <EnvBadge /> and <BuildTag />.
let infoPromise: Promise<AppConfig> | null = null;

/** The server's app config + build identity (never rejects). */
export function getAppInfo(): Promise<AppConfig> {
  if (!infoPromise) infoPromise = fetchAppConfig();
  return infoPromise;
}

/** Resolved (trimmed) NODE_ENV of the running server, or "" if unavailable. */
export function getEnvironment(): Promise<string> {
  return getAppInfo().then((c) => c.environment.trim());
}

/** Tooltip text for the build tag, e.g. "Build 0bdf0fa · 9/9/2026 · master". */
export function buildTitle(info: {
  commit: string;
  branch: string;
  buildTime: string;
}): string {
  const parts = [`Build ${info.commit || "unknown"}`];
  if (info.buildTime) {
    const d = new Date(info.buildTime);
    if (!Number.isNaN(d.getTime())) parts.push(d.toLocaleString());
  }
  if (info.branch) parts.push(info.branch);
  return parts.join(" · ");
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

function renderFloatingVersion(info: AppConfig): void {
  const mount = () => {
    if (document.getElementById("build-tag")) return;
    const el = document.createElement("div");
    el.id = "build-tag";
    el.textContent = `v${info.version}`;
    el.title = buildTitle(info);
    el.style.cssText = [
      "position:fixed",
      "left:12px",
      "bottom:12px",
      "z-index:2147483000",
      "color:var(--text-muted,#94a3b8)",
      "font:600 11px/1 'Inter',system-ui,-apple-system,sans-serif",
      "letter-spacing:0.02em",
      "pointer-events:none",
      "user-select:none",
    ].join(";");
    document.body.appendChild(el);
  };

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

async function initEnvTheme(): Promise<void> {
  const info = await getAppInfo();

  const palette = envPalette(info.environment);
  if (palette) applyPalette(palette);

  // React mounts synchronously at module load, well before this fetch
  // resolves, so #sidebar is already in the DOM here if the page has one.
  // Sidebar pages render <EnvBadge /> + <BuildTag /> themselves.
  if (!document.querySelector("#sidebar")) {
    if (palette) renderFloatingBadge(info.environment);
    if (info.version) renderFloatingVersion(info);
  }
}

void initEnvTheme();
