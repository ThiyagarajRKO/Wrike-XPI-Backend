// Storage keys match the existing EJS flow exactly (views/admin/totp.ejs and
// views/admin/dashboard.ejs read these same keys and are unchanged by this
// pilot) - the interim TOTP challenge token lives in sessionStorage, the
// final access token in localStorage.
const TOTP_TOKEN_KEY = "totp_token";
const ACCESS_TOKEN_KEY = "access_token";

export interface LoginResult {
  totpRequired: boolean;
  totpToken?: string;
  accessToken?: string;
}

export const getAccessToken = (): string | null =>
  localStorage.getItem(ACCESS_TOKEN_KEY);

export const setAccessToken = (token: string): void => {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
};

export const clearAdminSession = (): void => {
  localStorage.clear();
};

/**
 * Bearer-token fetch wrapper for the admin dashboard - mirrors the EJS
 * page's global fetch interceptor (views/admin/dashboard.ejs): on any 401 or
 * 403 response it clears localStorage, redirects to /admin/login, and
 * rejects so calling code's `await` never resolves with the stale response.
 */
export const adminFetch = async (
  input: string,
  init: RequestInit = {},
): Promise<Response> => {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(input, { ...init, headers });

  if (response.status === 401 || response.status === 403) {
    clearAdminSession();
    window.location.replace("/admin/login");
    throw new Error("Session expired or unauthorized");
  }

  return response;
};

/**
 * POST /api/v1/admin/logout - same JSON API the EJS page already calls.
 */
export const adminLogout = async (): Promise<void> => {
  try {
    await adminFetch("/api/v1/admin/logout", { method: "POST" });
  } finally {
    clearAdminSession();
  }
};

export const setTotpToken = (token: string): void => {
  sessionStorage.setItem(TOTP_TOKEN_KEY, token);
};

export const getTotpToken = (): string | null =>
  sessionStorage.getItem(TOTP_TOKEN_KEY);

export const clearTotpToken = (): void => {
  sessionStorage.removeItem(TOTP_TOKEN_KEY);
};

/**
 * POST /api/v1/admin/login - same JSON API the EJS page already calls,
 * unchanged by this migration. Throws with a user-facing message on failure.
 */
export const login = async (
  username: string,
  password: string,
): Promise<LoginResult> => {
  const res = await fetch("/api/v1/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok || !body?.success) {
    throw new Error(body?.message || "Invalid username or password");
  }

  if (body.data?.totp_required) {
    return { totpRequired: true, totpToken: body.data.totp_token };
  }

  return { totpRequired: false, accessToken: body.data?.access_token };
};

/**
 * POST /api/v1/admin/totp/verify - same JSON API the EJS page already calls.
 */
export const verifyTotp = async (
  totpToken: string,
  totpCode: string,
): Promise<string> => {
  const res = await fetch("/api/v1/admin/totp/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totp_token: totpToken, totp_code: totpCode }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok || !body?.success) {
    throw new Error(body?.message || "TOTP verification failed");
  }

  return body.data.access_token as string;
};
