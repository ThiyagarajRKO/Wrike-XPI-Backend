import { adminFetch } from "./authApi";

/* ── Environments (credentials) ─────────────────────────────────────────
   Mirrors GET/POST /api/v1/admin/credentials and PUT/DELETE
   /api/v1/admin/credentials/:id (src/routes/admin/credentials/index.js). */

export interface AdminEnvironment {
  id: string;
  environment_name: string;
  client_id: string;
  client_secret: string;
  account_id: string;
  xpi_api_modules_datahub_id: string;
  xpi_api_services_datahub_id: string;
  xpi_entity_datahub_id: string;
  xpi_field_mapping_datahub_id: string;
  xpi_request_form_field_mapping_datahub_id: string;
  xpi_request_form_mapping_datahub_id: string;
  xpi_space_name_datahub_id: string;
  campaign_space_id: string;
  is_active: boolean;
  is_visible: boolean;
  /** Gate 1 master switch — email/domain/IP allow list. */
  allowlist_check_enabled: boolean;
  /** Gate 2 master switch — Wrike Xtend API custom field. Flag only for now;
      enforcement is a later phase (see src/utils/environmentAccess.js). */
  custom_field_check_enabled: boolean;
  created_at?: string;
  updated_at?: string;
  owner_id?: string | null;
  deleted_at?: string | null;
}

export interface EnvironmentPayload {
  environment_name: string;
  client_id?: string;
  client_secret?: string;
  account_id?: string;
  xpi_api_modules_datahub_id?: string;
  xpi_api_services_datahub_id?: string;
  xpi_entity_datahub_id?: string;
  xpi_field_mapping_datahub_id?: string;
  xpi_request_form_field_mapping_datahub_id?: string;
  xpi_request_form_mapping_datahub_id?: string;
  xpi_space_name_datahub_id?: string;
  campaign_space_id?: string;
  is_visible: boolean;
  is_active: boolean;
}

async function parseJson(res: Response): Promise<any> {
  return res.json().catch(() => null);
}

export const listEnvironments = async (): Promise<AdminEnvironment[]> => {
  const res = await adminFetch("/api/v1/admin/credentials");
  const json = await parseJson(res);
  if (json?.success && Array.isArray(json.data)) {
    return json.data.map((c: any) => ({
      id: c.id,
      environment_name: c.environment_name || "",
      client_id: c.client_id || "",
      client_secret: c.client_secret || "",
      account_id: c.account_id || "",
      xpi_api_modules_datahub_id: c.xpi_api_modules_datahub_id || "",
      xpi_api_services_datahub_id: c.xpi_api_services_datahub_id || "",
      xpi_entity_datahub_id: c.xpi_entity_datahub_id || "",
      xpi_field_mapping_datahub_id: c.xpi_field_mapping_datahub_id || "",
      xpi_request_form_field_mapping_datahub_id:
        c.xpi_request_form_field_mapping_datahub_id || "",
      xpi_request_form_mapping_datahub_id:
        c.xpi_request_form_mapping_datahub_id || "",
      xpi_space_name_datahub_id: c.xpi_space_name_datahub_id || "",
      campaign_space_id: c.campaign_space_id || "",
      is_active: !!c.is_active,
      is_visible: !!c.is_visible,
      allowlist_check_enabled: c.allowlist_check_enabled !== false,
      custom_field_check_enabled: !!c.custom_field_check_enabled,
      created_at: c.created_at,
      updated_at: c.updated_at,
      owner_id: c.owner_id,
      deleted_at: c.deleted_at,
    }));
  }
  return [];
};

export const createEnvironment = async (
  payload: EnvironmentPayload,
): Promise<{ id: string }> => {
  const res = await adminFetch("/api/v1/admin/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson(res);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || "Save failed");
  }
  return json?.data;
};

export const updateEnvironment = async (
  id: string,
  payload: EnvironmentPayload,
): Promise<{ id: string }> => {
  const res = await adminFetch(`/api/v1/admin/credentials/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson(res);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || "Save failed");
  }
  return json?.data;
};

/** Flips is_active and/or is_visible only — the list row's own switches.
    Deliberately not routed through updateEnvironment(): that PUT requires the
    whole credential form (client_id, every Datahub id, ...); a row toggle
    has none of that. */
export const toggleEnvironmentStatus = async (
  id: string,
  payload: {
    is_active?: boolean;
    is_visible?: boolean;
    allowlist_check_enabled?: boolean;
    custom_field_check_enabled?: boolean;
  },
): Promise<void> => {
  const res = await adminFetch(`/api/v1/admin/credentials/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson(res);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || "Update failed");
  }
};

export const deleteEnvironment = async (id: string): Promise<void> => {
  const res = await adminFetch(`/api/v1/admin/credentials/${id}`, {
    method: "DELETE",
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json?.message || "Delete failed");
};

/* ── Portal users ────────────────────────────────────────────────────── */

export interface PortalUser {
  id: string;
  username: string;
  full_name?: string | null;
  email?: string | null;
  role: string;
  last_login_at?: string | null;
  is_active: boolean;
  must_change_password: boolean;
}

export const listPortalUsers = async (): Promise<PortalUser[]> => {
  const res = await adminFetch("/api/v1/admin/portal-users");
  const json = await parseJson(res);
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || "Failed to load users");
  }
  return json.data || [];
};

export const createPortalUser = async (payload: {
  username: string;
  password: string;
  role: string;
  full_name?: string;
  email?: string;
}): Promise<void> => {
  const res = await adminFetch("/api/v1/admin/portal-users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson(res);
  if (!res.ok || !json?.success) throw new Error(json?.message);
};

export const generatePortalUserCredentials = async (): Promise<{
  username: string;
  password: string;
}> => {
  const res = await adminFetch("/api/v1/admin/portal-users/generate-credentials", {
    method: "POST",
  });
  const json = await parseJson(res);
  if (!res.ok || !json?.success) throw new Error(json?.message);
  return json.data;
};

export const updatePortalUser = async (
  id: string,
  payload: { username?: string; full_name?: string | null; email?: string | null },
): Promise<void> => {
  const res = await adminFetch(`/api/v1/admin/portal-users/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson(res);
  if (!res.ok || !json?.success) throw new Error(json?.message);
};

export const resetPortalUserPassword = async (
  id: string,
  new_password: string,
): Promise<void> => {
  const res = await adminFetch(`/api/v1/admin/portal-users/${id}/reset-password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_password }),
  });
  const json = await parseJson(res);
  if (!res.ok || !json?.success) throw new Error(json?.message);
};

export const togglePortalUserStatus = async (
  id: string,
  is_active: boolean,
): Promise<void> => {
  const res = await adminFetch(`/api/v1/admin/portal-users/${id}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active }),
  });
  const json = await parseJson(res);
  if (!res.ok || !json?.success) throw new Error(json?.message);
};

export const getPortalUserEnvironments = async (
  id: string,
): Promise<AdminEnvironment[]> => {
  const res = await adminFetch(`/api/v1/admin/portal-users/${id}/environments`);
  const json = await parseJson(res);
  return json?.data || [];
};

export const assignPortalUserEnvironment = async (
  id: string,
  env_id: string,
): Promise<void> => {
  const res = await adminFetch(`/api/v1/admin/portal-users/${id}/environments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ env_id }),
  });
  const json = await parseJson(res);
  if (!res.ok || !json?.success) throw new Error(json?.message);
};

export const revokePortalUserEnvironment = async (
  id: string,
  envId: string,
): Promise<void> => {
  const res = await adminFetch(
    `/api/v1/admin/portal-users/${id}/environments?env_id=${envId}`,
    { method: "DELETE" },
  );
  const json = await parseJson(res);
  if (!res.ok || !json?.success) throw new Error(json?.message);
};

/* ── Cache ───────────────────────────────────────────────────────────── */

export interface CacheEntry {
  key: string;
  redis_type: string;
  value_type: string;
  ttl_seconds: number | null;
  ttl_label: string;
  size_bytes: number;
  preview: string;
}

export const listCacheEntries = async (pattern: string): Promise<CacheEntry[]> => {
  const patternQuery = pattern ? `pattern=${encodeURIComponent(pattern)}&` : "";
  const res = await adminFetch(`/api/v1/admin/cache?${patternQuery}limit=500`);
  const json = await parseJson(res);
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || "Failed to load cache entries");
  }
  return json?.data?.entries || [];
};

export const getCacheDetail = async (
  key: string,
): Promise<{
  redis_type: string;
  value_type: string;
  ttl_label: string;
  value: any;
}> => {
  const res = await adminFetch(`/api/v1/admin/cache/detail?key=${encodeURIComponent(key)}`);
  const json = await parseJson(res);
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || "Failed to fetch cache detail");
  }
  return json.data || {};
};

export const deleteCacheEntry = async (key: string): Promise<void> => {
  const res = await adminFetch(`/api/v1/admin/cache?key=${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  const json = await parseJson(res);
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || "Failed to delete cache key");
  }
};

export const bulkDeleteCacheEntries = async (
  keys: string[],
): Promise<{ message?: string }> => {
  const res = await adminFetch("/api/v1/admin/cache/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
  });
  const json = await parseJson(res);
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || "Failed to delete selected keys");
  }
  return json;
};
