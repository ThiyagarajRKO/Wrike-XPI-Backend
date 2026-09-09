export interface AppConfig {
  appUrl: string;
  wrikeRedirectUrl: string;
  /** NODE_ENV of the running server (LOCAL, DEVELOPMENT, LIVE, UAT, ...). */
  environment: string;
  /** Build identity — see src/utils/version.js on the server. */
  version: string;
  commit: string;
  branch: string;
  /** ISO string, or "" in dev / when unavailable. */
  buildTime: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  appUrl: "",
  wrikeRedirectUrl: "",
  environment: "",
  version: "",
  commit: "",
  branch: "",
  buildTime: "",
};

/**
 * GET /api/v1/app-config — non-secret app config (APP_URL / WRIKE_REDIRECT_URL /
 * NODE_ENV env vars + server build identity) fetched client-side. Shared by
 * AdminDashboard.tsx and PortalHome.tsx, plus envTheme.ts (which reads
 * `environment` on every page and feeds the build tag) — only the server knows
 * these values, so they can't be derived client-side the way other pages' state
 * can, but there's nothing page-specific about them.
 */
export const fetchAppConfig = async (): Promise<AppConfig> => {
  try {
    const res = await fetch("/api/v1/app-config");
    const body = await res.json().catch(() => null);
    if (!body?.success || !body?.data) return DEFAULT_CONFIG;
    return {
      appUrl: body.data.appUrl || "",
      wrikeRedirectUrl: body.data.wrikeRedirectUrl || "",
      environment: body.data.environment || "",
      version: body.data.version || "",
      commit: body.data.commit || "",
      branch: body.data.branch || "",
      buildTime: body.data.buildTime || "",
    };
  } catch {
    return DEFAULT_CONFIG;
  }
};
