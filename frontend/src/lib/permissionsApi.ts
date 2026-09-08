import { adminFetch } from "./authApi";

/* ── Types ──────────────────────────────────────────────────────────────
   Mirrors /api/v1/admin/permissions/* (src/routes/admin/permissions/index.js).
   The module and role vocabulary is *fetched*, not declared here — the
   backend catalog (src/utils/permissionCatalog.js) is the single authority,
   so adding a module there grows this UI without a frontend edit. */

export type ActionName = "read" | "create" | "update" | "delete";

export interface ModuleDef {
  key: string;
  label: string;
  description: string;
  /** Actions this module can actually express — others render disabled. */
  actions: ActionName[];
}

export type PermissionMatrix = Record<string, Record<ActionName, boolean>>;

export interface RoleDef {
  key: string;
  label: string;
  description: string;
  permissions: PermissionMatrix;
}

export interface PermissionCatalog {
  actions: ActionName[];
  modules: ModuleDef[];
  roles: RoleDef[];
}

export interface ScopedEnvironment {
  id: string;
  environment_name: string;
  is_active: boolean;
  is_visible: boolean;
}

export interface UserAccessSummary {
  user: {
    id: string;
    username: string;
    full_name: string | null;
    email: string | null;
    role: string;
    is_active: boolean;
    last_login_at: string | null;
  };
  environment_scope: ScopedEnvironment[];
  permissions: PermissionMatrix;
  /** null means the matrix matches no role exactly — show it as "Custom". */
  role: string | null;
  configured: boolean;
}

export interface MatrixSummary {
  permissions: PermissionMatrix;
  role: string | null;
  configured: boolean;
}

/* ── Transport ──────────────────────────────────────────────────────── */

const BASE = "/api/v1/admin/permissions";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await adminFetch(`${BASE}${path}`, init);
  const json = await res.json().catch(() => null);

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

export const getPermissionCatalog = () =>
  request<PermissionCatalog>("/catalog");

export const getUserAccessSummary = (userId: string) =>
  request<UserAccessSummary>(`/users/${userId}`);

export const setUserPermissions = (
  userId: string,
  permissions: PermissionMatrix,
) =>
  request<{ permissions: PermissionMatrix; role: string | null }>(
    `/users/${userId}`,
    jsonBody("PUT", { permissions }),
  );

export const getPermissionOverview = (userIds: string[]) =>
  request<Record<string, MatrixSummary>>(
    "/overview",
    jsonBody("POST", { user_ids: userIds }),
  );

/* ── Shaping helpers ────────────────────────────────────────────────── */

/** An all-false matrix shaped to a catalog — the safe starting point. */
export const emptyMatrix = (modules: ModuleDef[]): PermissionMatrix =>
  Object.fromEntries(
    modules.map((m) => [
      m.key,
      { read: false, create: false, update: false, delete: false },
    ]),
  );

const sameMatrix = (
  a: PermissionMatrix,
  b: PermissionMatrix,
  modules: ModuleDef[],
): boolean =>
  modules.every((m) =>
    (["read", "create", "update", "delete"] as ActionName[]).every(
      (action) => !!a?.[m.key]?.[action] === !!b?.[m.key]?.[action],
    ),
  );

/**
 * The role a matrix exactly matches, or null for a hand-tuned combination.
 * Mirrors roleForMatrix() on the server so the UI can relabel live as an
 * admin ticks cells, without a round trip just to learn the role name.
 */
export const roleForMatrix = (
  permissions: PermissionMatrix,
  catalog: PermissionCatalog | null,
): string | null => {
  if (!catalog) return null;
  const found = catalog.roles.find((r) =>
    sameMatrix(r.permissions, permissions, catalog.modules),
  );
  return found ? found.key : null;
};

export const roleLabel = (
  roleKey: string | null,
  catalog: PermissionCatalog | null,
): string => {
  if (!roleKey) return "Custom";
  return catalog?.roles.find((r) => r.key === roleKey)?.label || "Custom";
};

/** Total granted cells — drives the "3 of 13" style summary counts. */
export const grantedCount = (
  permissions: PermissionMatrix,
  modules: ModuleDef[],
): { granted: number; total: number } => {
  let granted = 0;
  let total = 0;

  for (const mod of modules) {
    for (const action of mod.actions) {
      total += 1;
      if (permissions?.[mod.key]?.[action]) granted += 1;
    }
  }

  return { granted, total };
};
