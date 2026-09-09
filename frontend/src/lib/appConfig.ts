export interface AppConfig {
  appUrl: string;
  wrikeRedirectUrl: string;
  /** NODE_ENV of the running server (LOCAL, DEVELOPMENT, LIVE, UAT, ...). */
  environment: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  appUrl: "",
  wrikeRedirectUrl: "",
  environment: "",
};

/**
 * GET /api/v1/app-config — non-secret app config (APP_URL / WRIKE_REDIRECT_URL /
 * NODE_ENV env vars) fetched client-side. Shared by AdminDashboard.tsx and
 * PortalHome.tsx, plus envTheme.ts (which reads `environment` on every page) —
 * only the server knows these values, so they can't be derived client-side the
 * way other pages' state can, but there's nothing page-specific about them.
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
    };
  } catch {
    return DEFAULT_CONFIG;
  }
};
