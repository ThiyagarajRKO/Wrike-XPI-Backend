import { adminFetch } from "./authApi";

/* ── Types ──────────────────────────────────────────────────────────────
   Mirrors /api/v1/admin/environment-access/* (src/routes/admin/environmentAccess). */

export type RuleType = "email" | "domain" | "ip";

/** Which surface an entry grants access to. */
export type AppliesTo = "api" | "mcp" | "both";

/** The surface the check simulator evaluates against. */
export type Surface = "api" | "mcp";

export interface AccessRule {
  id: string;
  env_id: string;
  rule_type: RuleType;
  value: string;
  label: string | null;
  applies_to: AppliesTo;
  is_enabled: boolean;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AccessSummaryRow {
  env_id: string;
  rules_total: number;
  rules_enabled: number;
}

export type CheckStatus = "pass" | "fail";

export interface CheckStep {
  status: CheckStatus;
  detail: string;
}

export interface CheckResult {
  allowed: boolean;
  code: string;
  message: string;
  email: string | null;
  ip: string | null;
  surface: Surface;
  matchedRule: {
    rule_type: RuleType;
    value: string;
    label: string | null;
    applies_to: AppliesTo;
  } | null;
  checks: CheckStep[];
}

/* ── Transport ──────────────────────────────────────────────────────── */

const BASE = "/api/v1/admin/environment-access";

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

/** The IP the server sees this admin's request from — the exact value the
    real IP allow-list gate reads, so "Use my IP" always fills in something
    that would actually match if saved as-is. */
export const getMyIp = () => request<{ ip: string | null }>("/my-ip");

export const getAccessSummary = () =>
  request<Record<string, AccessSummaryRow>>("/summary").then((rows) => rows || {});

export const listRules = (envId: string) =>
  request<AccessRule[]>(`/rules?env_id=${encodeURIComponent(envId)}`).then(
    (rows) => rows || [],
  );

export const createRule = (payload: {
  env_id: string;
  rule_type: RuleType;
  value: string;
  label?: string | null;
  applies_to?: AppliesTo;
  is_enabled?: boolean;
}) => request<AccessRule>("/rules", jsonBody("POST", payload));

export const updateRule = (
  id: string,
  payload: {
    value?: string;
    label?: string | null;
    applies_to?: AppliesTo;
    is_enabled?: boolean;
  },
) => request<AccessRule>(`/rules/${id}`, jsonBody("PUT", payload));

export const deleteRule = (id: string) =>
  request<null>(`/rules/${id}`, { method: "DELETE" });

export const checkAccess = (
  env_id: string,
  email: string,
  ip: string,
  surface: Surface = "api",
) =>
  request<CheckResult>(
    "/check",
    jsonBody("POST", {
      env_id,
      email: email || undefined,
      ip: ip || undefined,
      surface,
    }),
  );

/* ── Shaping helpers ───────────────────────────────────────────────── */

const RULE_TYPE_LABEL: Record<RuleType, string> = {
  email: "Email",
  domain: "Domain",
  ip: "IP address",
};

export const ruleTypeLabel = (type: RuleType) => RULE_TYPE_LABEL[type];

const APPLIES_TO_LABEL: Record<AppliesTo, string> = {
  api: "API",
  mcp: "MCP",
  both: "API + MCP",
};

export const appliesToLabel = (scope: AppliesTo) => APPLIES_TO_LABEL[scope] || scope;

export const APPLIES_TO_OPTIONS: { value: AppliesTo; label: string; hint: string }[] = [
  { value: "both", label: "API + MCP", hint: "Works everywhere" },
  { value: "api", label: "API only", hint: "REST calls only" },
  { value: "mcp", label: "MCP only", hint: "MCP agents only" },
];

/**
 * Guess the rule type from raw input as the admin types, so they don't have
 * to pick a tab before they've typed anything. Order matters: an IP is the
 * most structurally distinct, then an email (has "@"), then everything else
 * is treated as a domain.
 */
export const inferRuleType = (raw: string): RuleType => {
  const value = raw.trim();
  if (!value) return "email";
  if (/^[0-9a-f:.]+(\/\d{1,3})?$/i.test(value) && (value.includes(":") || value.includes("."))) {
    // Only treat it as an IP if it doesn't look like an email/domain — a bare
    // dotted token with no "@" and no letters outside hex is the IPv4 case;
    // IPv6 always has a colon.
    if (value.includes(":") || /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(value)) {
      return "ip";
    }
  }
  if (value.includes("@")) return "email";
  return "domain";
};
