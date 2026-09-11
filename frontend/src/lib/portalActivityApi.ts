import { portalFetch } from "./portalAuthApi";
import { toQueryString } from "./queryString";

/* ── Types ──────────────────────────────────────────────────────────────
   Mirrors /api/v1/portal/activity-logs/* (src/routes/portal/activity/index.js),
   the read-only counterpart of frontend/src/lib/activityLogApi.ts. */

export type PortalSurface = "rest" | "mcp";

export interface PortalActivityRow {
  id: string;
  env_id: string | null;
  environment_name: string | null;
  surface: PortalSurface;
  actor_email: string | null;
  action: string | null;
  resource: string;
  method: string | null;
  allowed: boolean;
  code: string | null;
  status_code: number | null;
  ip: string | null;
  category: string | null;
  created_at: string;
}

export interface PortalActivityList {
  rows: PortalActivityRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface PortalActivitySummary {
  total: number;
  allowed: number;
  denied: number;
}

export interface PortalActivityConfig {
  retention_days: number;
}

export interface PortalActivityFilters {
  env_id?: string;
  actor_email?: string;
  surface?: PortalSurface;
  allowed?: boolean;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

const BASE = "/api/v1/portal/activity-logs";

async function request<T>(token: string, path: string): Promise<T> {
  const res = await portalFetch(`${BASE}${path}`, token);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || "Request failed");
  }
  return json?.data as T;
}

const qs = (filters: PortalActivityFilters): string =>
  toQueryString({
    env_id: filters.env_id,
    actor_email: filters.actor_email,
    surface: filters.surface,
    allowed: filters.allowed === undefined ? undefined : String(filters.allowed),
    from: filters.from,
    to: filters.to,
    limit: filters.limit,
    offset: filters.offset,
  });

export const getPortalActivitySummary = (token: string, envId?: string) =>
  request<PortalActivitySummary>(token, `/summary${toQueryString({ env_id: envId })}`);

/** GET /api/v1/portal/activity-logs/config — how long rows are kept, so the
    page can show the same retention note the admin console does. */
export const getPortalActivityConfig = (token: string) =>
  request<PortalActivityConfig>(token, "/config");

export const listPortalActivity = (token: string, filters: PortalActivityFilters = {}) =>
  request<PortalActivityList>(token, qs(filters));
