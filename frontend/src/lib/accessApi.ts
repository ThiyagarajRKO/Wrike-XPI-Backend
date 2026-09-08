import { adminFetch } from "./authApi";

/* ── Types ──────────────────────────────────────────────────────────────
   Mirrors /api/v1/admin/access/* (src/routes/admin/access/index.js). */

export type RuleType = "email" | "domain";

export type ActionName = "read" | "create" | "update" | "delete";

export const ACTION_NAMES: ActionName[] = ["read", "create", "update", "delete"];

export interface Grant {
  can_read: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
}

export interface AccessRule extends Grant {
  id: string;
  env_id: string;
  rule_type: RuleType;
  value: string;
  label: string | null;
  is_enabled: boolean;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface UserPermission extends Grant {
  id: string;
  env_id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AccessSummaryRow {
  env_id: string;
  rules_total: number;
  rules_enabled: number;
  users_total: number;
}

export interface AccessConfig {
  custom_field_name: string;
  enforced: boolean;
  actions: ActionName[];
}

export type GateStatus = "pass" | "fail" | "skipped" | "pending";

export interface AccessGate {
  key: string;
  label: string;
  status: GateStatus;
  detail: string;
}

export interface SimulationResult {
  allowed: boolean;
  code: string;
  email: string;
  matchedRule: { value: string; rule_type: RuleType } | null;
  source: "user_override" | "rule_baseline" | null;
  permissions: Record<ActionName, boolean>;
  gates: AccessGate[];
}

/* ── Transport ──────────────────────────────────────────────────────── */

const BASE = "/api/v1/admin/access";

async function parseJson(res: Response): Promise<any> {
  return res.json().catch(() => null);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await adminFetch(`${BASE}${path}`, init);
  const json = await parseJson(res);

  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || "Request failed");
  }

  return json?.data as T;
}

const jsonBody = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/* ── Config & summary ───────────────────────────────────────────────── */

export const getAccessConfig = () => request<AccessConfig>("/config");

export const getAccessSummary = () =>
  request<AccessSummaryRow[]>("/summary").then((rows) => rows || []);

/* ── Allow list ─────────────────────────────────────────────────────── */

export const listRules = (envId: string) =>
  request<AccessRule[]>(`/rules?env_id=${encodeURIComponent(envId)}`).then(
    (rows) => rows || [],
  );

export const createRule = (payload: {
  env_id: string;
  rule_type: RuleType;
  value: string;
  label?: string | null;
  is_enabled?: boolean;
} & Partial<Grant>) => request<AccessRule>("/rules", jsonBody("POST", payload));

export const bulkCreateRules = (
  env_id: string,
  entries: Array<{ value: string; rule_type: RuleType } & Partial<Grant>>,
) =>
  request<{ created: number; skipped: string[] }>(
    "/rules/bulk",
    jsonBody("POST", { env_id, entries }),
  );

export const updateRule = (
  id: string,
  payload: Partial<Grant> & {
    value?: string;
    label?: string | null;
    is_enabled?: boolean;
  },
) => request<AccessRule>(`/rules/${id}`, jsonBody("PUT", payload));

export const deleteRule = (id: string) =>
  request<null>(`/rules/${id}`, { method: "DELETE" });

/* ── Per-user permissions ───────────────────────────────────────────── */

export const listPermissions = (envId: string) =>
  request<UserPermission[]>(
    `/permissions?env_id=${encodeURIComponent(envId)}`,
  ).then((rows) => rows || []);

export const listKnownEmails = (envId: string) =>
  request<string[]>(
    `/permissions/known?env_id=${encodeURIComponent(envId)}`,
  ).then((rows) => rows || []);

export const upsertPermission = (
  payload: {
    env_id: string;
    email: string;
    display_name?: string | null;
  } & Partial<Grant>,
) => request<UserPermission>("/permissions", jsonBody("POST", payload));

export const updatePermission = (id: string, payload: Partial<Grant>) =>
  request<UserPermission>(`/permissions/${id}`, jsonBody("PUT", payload));

export const deletePermission = (id: string) =>
  request<null>(`/permissions/${id}`, { method: "DELETE" });

/* ── Simulator ──────────────────────────────────────────────────────── */

export const simulateAccess = (env_id: string, email: string) =>
  request<SimulationResult>("/simulate", jsonBody("POST", { env_id, email }));

/* ── Shared shaping helpers ─────────────────────────────────────────── */

export const grantColumn = (action: ActionName): keyof Grant =>
  (`can_${action}` as keyof Grant);

export const grantedActions = (grant: Grant): ActionName[] =>
  ACTION_NAMES.filter((action) => grant[grantColumn(action)]);
