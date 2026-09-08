import { adminFetch } from "./authApi";

/* ── Types ──────────────────────────────────────────────────────────────
   Mirrors /api/v1/admin/activity/* (src/routes/admin/activity/index.js). */

export type Surface = "rest" | "mcp";

export interface ActivityRow {
  id: string;
  env_id: string | null;
  environment_name: string | null;
  surface: Surface;
  actor_email: string | null;
  action: string | null;
  resource: string;
  method: string | null;
  allowed: boolean;
  code: string | null;
  status_code: number | null;
  ip: string | null;
  category: string | null;
  request_payload: unknown;
  response_payload: unknown;
  created_at: string;
}

export interface ActivityList {
  rows: ActivityRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface ActivitySummary {
  total: number;
  allowed: number;
  denied: number;
}

export interface ActivityConfig {
  retention_days: number;
}

export interface ActivityFilters {
  env_id?: string;
  actor_email?: string;
  surface?: Surface;
  allowed?: boolean;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

const BASE = "/api/v1/admin/activity";

async function request<T>(path: string): Promise<T> {
  const res = await adminFetch(`${BASE}${path}`);
  const json = await res.json().catch(() => null);

  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || "Request failed");
  }

  return json?.data as T;
}

const qs = (filters: ActivityFilters): string => {
  const params = new URLSearchParams();
  if (filters.env_id) params.set("env_id", filters.env_id);
  if (filters.actor_email) params.set("actor_email", filters.actor_email);
  if (filters.surface) params.set("surface", filters.surface);
  if (filters.allowed !== undefined) params.set("allowed", String(filters.allowed));
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
  const s = params.toString();
  return s ? `?${s}` : "";
};

export const getActivityConfig = () => request<ActivityConfig>("/config");

export const getActivitySummary = (envId?: string) =>
  request<ActivitySummary>(`/summary${envId ? `?env_id=${envId}` : ""}`);

export const listActivity = (filters: ActivityFilters = {}) =>
  request<ActivityList>(`${qs(filters)}`);
