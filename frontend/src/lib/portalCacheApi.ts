import { portalFetch } from "./portalAuthApi";

/* ── Types ──────────────────────────────────────────────────────────────
   Mirrors /api/v1/portal/cache/* (src/routes/portal/cache/index.js), the
   portal counterpart of the admin cache API in frontend/src/lib/adminApi.ts —
   browse, inspect, and single-key delete (no bulk-delete on the portal side). */

export interface PortalCacheEntry {
  key: string;
  redis_type: string;
  value_type: string;
  ttl_seconds: number | null;
  ttl_label: string;
  size_bytes: number;
  preview: string;
}

export interface PortalCacheDetail {
  key: string;
  redis_type: string;
  value_type: string;
  ttl_seconds: number | null;
  ttl_label: string;
  value_source: string;
  value: unknown;
}

export const listPortalCacheEntries = async (
  token: string,
  pattern: string,
): Promise<PortalCacheEntry[]> => {
  const params = new URLSearchParams({ limit: "500" });
  if (pattern) params.set("pattern", pattern);
  const res = await portalFetch(`/api/v1/portal/cache?${params}`, token);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || "Failed to load cache entries");
  }
  return json?.data?.entries || [];
};

export const getPortalCacheDetail = async (
  token: string,
  key: string,
): Promise<PortalCacheDetail> => {
  const params = new URLSearchParams({ key });
  const res = await portalFetch(`/api/v1/portal/cache/detail?${params}`, token);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || "Failed to fetch cache detail");
  }
  return json.data as PortalCacheDetail;
};

export const deletePortalCacheEntry = async (token: string, key: string): Promise<void> => {
  const params = new URLSearchParams({ key });
  const res = await portalFetch(`/api/v1/portal/cache?${params}`, token, { method: "DELETE" });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || "Failed to delete cache key");
  }
};
