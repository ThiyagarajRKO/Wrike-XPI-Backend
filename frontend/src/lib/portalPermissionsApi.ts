import { adminFetch } from "./authApi";

/* ── Types ──────────────────────────────────────────────────────────────
   Mirrors /api/v1/admin/portal-users/:id/permissions and .../permissions/catalog
   (src/routes/admin/users/index.js). Module/action vocabulary is *fetched*,
   not declared here — src/utils/portalPermissionCatalog.js is the single
   authority, so a module added there grows this UI with no frontend edit. */

export type ActionName = "read" | "create" | "update" | "delete";

export interface ModuleDef {
  key: string;
  label: string;
  description: string;
  /** Actions this module can actually express — others render disabled. */
  actions: ActionName[];
}

export type PermissionMatrix = Record<string, Record<ActionName, boolean>>;

export interface PermissionCatalog {
  actions: ActionName[];
  modules: ModuleDef[];
}

const BASE = "/api/v1/admin/portal-users";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await adminFetch(`${BASE}${path}`, init);
  const json = await res.json().catch(() => null);

  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || "Request failed");
  }

  return json?.data as T;
}

export const getPermissionCatalog = () =>
  request<PermissionCatalog>("/permissions/catalog");

export const getUserPermissions = (userId: string) =>
  request<PermissionMatrix>(`/${userId}/permissions`);

export const setUserPermissions = (userId: string, permissions: PermissionMatrix) =>
  request<PermissionMatrix>(`/${userId}/permissions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permissions }),
  });

/* ── Shaping helpers ───────────────────────────────────────────────── */

/** Total granted cells — drives the "3 of 9 granted" summary line. */
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
