// Storage keys match the existing EJS flow exactly (views/portal/dashboard.ejs
// and views/portal/user.ejs read these same keys, unchanged by this
// migration) - distinct from the admin app's keys (portal_* prefix).
const ACCESS_TOKEN_KEY = "portal_access_token";
const ROLE_KEY = "portal_role";

export interface PortalLoginResult {
  accessToken: string;
  role: string;
  mustChangePassword: boolean;
}

export const getPortalToken = (): string | null =>
  localStorage.getItem(ACCESS_TOKEN_KEY);

export const getPortalRole = (): string | null => localStorage.getItem(ROLE_KEY);

export const setPortalSession = (accessToken: string, role: string): void => {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(ROLE_KEY, role);
};

export const clearPortalSession = (): void => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
};

/** Where to send an authenticated user, matching the original EJS scripts' logic. */
export const portalHomeFor = (role: string | null): string =>
  role === "admin" ? "/portal/dashboard" : "/portal/home";

/**
 * POST /api/v1/portal/auth/login - same JSON API the EJS page already calls.
 */
export const portalLogin = async (
  username: string,
  password: string,
): Promise<PortalLoginResult> => {
  const res = await fetch("/api/v1/portal/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok || !body?.success) {
    throw new Error(body?.message || "Invalid credentials");
  }

  return {
    accessToken: body.data.access_token,
    role: body.data.role,
    mustChangePassword: !!body.data.must_change_password,
  };
};

/**
 * POST /api/v1/portal/auth/change-password - same JSON API the EJS page
 * already calls.
 */
export const changePortalPassword = async (
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {
  const res = await fetch("/api/v1/portal/auth/change-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok || !body?.success) {
    throw new Error(body?.message || "Failed to update password");
  }
};

/**
 * Thrown by `portalFetch` when the response is 401/403, after the caller's
 * session has already been cleared and the browser redirected to
 * /portal/login - mirrors the EJS dashboard's global `window.fetch`
 * interceptor, scoped to the calls a given page actually makes instead of
 * monkey-patching the global fetch.
 */
export class PortalSessionExpiredError extends Error {
  constructor() {
    super("Session expired or unauthorized");
    this.name = "PortalSessionExpiredError";
  }
}

/**
 * `fetch` wrapper carrying the portal Bearer token, matching the EJS
 * dashboard's `authHeaders()` + response interceptor: a 401/403 clears the
 * stored session and replaces the location with /portal/login.
 */
export const portalFetch = async (
  input: string,
  token: string,
  init?: RequestInit,
): Promise<Response> => {
  const res = await fetch(input, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  });

  if (res.status === 401 || res.status === 403) {
    clearPortalSession();
    window.location.replace("/portal/login");
    throw new PortalSessionExpiredError();
  }

  return res;
};

export interface PortalEnvironment {
  id: string;
  environment_name: string;
  account_id: string;
  is_active: boolean;
  is_visible: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * GET /api/v1/portal/environments/ - same JSON API the EJS dashboard already
 * calls.
 */
export const listPortalEnvironments = async (
  token: string,
): Promise<PortalEnvironment[]> => {
  const res = await portalFetch("/api/v1/portal/environments/", token);
  const body = await res.json().catch(() => null);

  if (!body?.success || !Array.isArray(body.data)) return [];

  return body.data.map((c: Record<string, unknown>) => ({
    id: c.id,
    environment_name: c.environment_name || "",
    account_id: c.account_id || "",
    is_active: !!c.is_active,
    is_visible: !!c.is_visible,
    created_at: c.created_at ?? null,
    updated_at: c.updated_at ?? null,
  }));
};

/**
 * Full environment record, as used by the portal "My Environments" CRUD page
 * (views/portal/user.ejs) - a superset of PortalEnvironment carrying the
 * credential and datahub-id fields the add/edit modal reads and writes.
 */
export interface PortalEnvironmentFull {
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
  created_at: string | null;
  updated_at: string | null;
}

/**
 * GET /api/v1/portal/environments/ - same JSON API the EJS user page already
 * calls, kept full-fidelity (raw fields, no boolean/string coercion) since
 * this page's edit modal round-trips every field back to the server as-is.
 */
export const listPortalEnvironmentsFull = async (
  token: string,
): Promise<PortalEnvironmentFull[]> => {
  const res = await portalFetch("/api/v1/portal/environments/", token);
  const body = await res.json().catch(() => null);
  if (!body?.success || !Array.isArray(body.data)) return [];
  return body.data as PortalEnvironmentFull[];
};

export interface PortalEnvironmentInput {
  environment_name: string;
  client_id: string;
  client_secret: string;
  account_id: string | null;
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
}

/**
 * POST /api/v1/portal/environments/ - same JSON API the EJS user page's
 * "Add Environment" save button already calls.
 */
export const createPortalEnvironment = async (
  token: string,
  input: PortalEnvironmentInput,
): Promise<PortalEnvironmentFull> => {
  const res = await portalFetch("/api/v1/portal/environments/", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => null);
  if (!body?.success) throw new Error(body?.message || "Request failed");
  return body.data as PortalEnvironmentFull;
};

/**
 * PUT /api/v1/portal/environments/:id - same JSON API the EJS user page's
 * "Edit Environment" save button already calls.
 */
export const updatePortalEnvironment = async (
  token: string,
  id: string,
  input: PortalEnvironmentInput,
): Promise<PortalEnvironmentFull> => {
  const res = await portalFetch(`/api/v1/portal/environments/${id}`, token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => null);
  if (!body?.success) throw new Error(body?.message || "Request failed");
  return body.data as PortalEnvironmentFull;
};

/**
 * DELETE /api/v1/portal/environments/:id - same JSON API the EJS user page's
 * delete button already calls.
 */
export const deletePortalEnvironment = async (
  token: string,
  id: string,
): Promise<void> => {
  const res = await portalFetch(`/api/v1/portal/environments/${id}`, token, {
    method: "DELETE",
  });
  const body = await res.json().catch(() => null);
  if (!body?.success) throw new Error(body?.message || "Delete failed");
};

/**
 * POST /api/v1/portal/logout - same JSON API the EJS dashboard already
 * calls.
 */
export const portalLogout = async (token: string): Promise<void> => {
  await portalFetch("/api/v1/portal/logout", token, { method: "POST" });
};
