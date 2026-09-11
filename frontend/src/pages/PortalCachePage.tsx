import { useCallback, useEffect, useRef, useState } from "react";
import { getPortalToken } from "../lib/portalAuthApi";
import {
  bulkDeletePortalCacheEntries,
  deletePortalCacheEntry,
  getPortalCacheDetail,
  listPortalCacheEntries,
  type PortalCacheDetail,
  type PortalCacheEntry,
} from "../lib/portalCacheApi";
import { CacheTable } from "../components/CacheTable";
import { confirmDanger, escHtml, toast } from "../lib/notify";
import "./PortalCachePage.css";

/* The portal Cache Settings page.
 *
 * The admin console's Cache Settings page on the portal API: the same section
 * header with the bulk-delete button, the same card, and the same shared
 * <CacheTable /> (frontend/src/components/CacheTable.tsx) — one
 * implementation, not two that drift. The row and bulk deletes behave exactly
 * as the admin console's do, including the "Delete Selected (n)" /
 * "Delete All" label.
 *
 * Permission gating, which is the only thing that differs between the two
 * surfaces:
 *   read   → the page, the table, the View action (and the key detail modal)
 *   delete → the selection column, per-row Delete, Delete This Key in the
 *            modal, and Delete Selected / Delete All
 * Both deletes are enforced server-side as well
 * (requirePortalPermission("cache", "delete") in
 * src/routes/portal/cache/index.js), so a read-only portal user is never
 * shown a control that would 403.
 */

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

interface Props {
  active: boolean;
  /** The "cache:delete" grant from the portal permission matrix. */
  canDelete: boolean;
}

export default function PortalCachePage({ active, canDelete }: Props) {
  const token = getPortalToken();

  const [entries, setEntries] = useState<PortalCacheEntry[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [pattern, setPattern] = useState("");
  const [loading, setLoading] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Read by callbacks that must not re-create themselves on every keystroke
  // (the post-delete reload — same reason the admin page keeps a ref here).
  const patternRef = useRef(pattern);
  patternRef.current = pattern;

  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<PortalCacheDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(
    async (patternOverride?: string) => {
      if (!token) return;
      const normalized =
        typeof patternOverride === "string" ? patternOverride.trim() : patternRef.current;

      setPattern(normalized);
      setLoading(true);
      try {
        const data = await listPortalCacheEntries(token, normalized);
        setEntries(data);
        setSelectedKeys(new Set());
      } catch (err) {
        setEntries([]);
        setSelectedKeys(new Set());
        toast((err as Error).message || "Failed to load cache data", "error");
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!active) return;
    setPattern("");
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /* Stable identity so <CacheTable />'s debounce effect isn't torn down and
     rebuilt on every parent render, which would restart the timer and mean
     the query never fires while the user keeps typing. */
  const handleSearch = useCallback(
    (nextPattern: string) => {
      load(nextPattern);
    },
    [load],
  );

  const closeDetail = useCallback(() => {
    setDetailKey(null);
    setDetail(null);
  }, []);

  const openDetail = useCallback(
    async (key: string) => {
      if (!token) return;
      setDetailKey(key);
      setDetail(null);
      setDetailLoading(true);
      try {
        const data = await getPortalCacheDetail(token, key);
        setDetail(data);
      } catch (err) {
        setDetail(null);
        closeDetail();
        toast((err as Error).message || "Failed to load key detail", "error");
      } finally {
        setDetailLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token],
  );

  const deleteKey = useCallback(
    async (key: string) => {
      if (!token || !canDelete) return;

      const confirmed = await confirmDanger({
        title: "Delete Cache Key?",
        html: `This will remove <strong>${escHtml(key)}</strong> from Redis.`,
      });
      if (!confirmed) return;

      try {
        await deletePortalCacheEntry(token, key);
        toast("Cache key deleted", "success");
        if (detailKey === key) closeDetail();
        await load(patternRef.current);
      } catch (err) {
        toast((err as Error).message || "Failed to delete cache key", "error");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, canDelete, detailKey, load, closeDetail],
  );

  const handleBulkDelete = async () => {
    if (!token || !canDelete) return;

    // Same rule as the admin console: a selection means "these", no selection
    // means "everything currently listed".
    const keys = selectedKeys.size > 0 ? Array.from(selectedKeys) : entries.map((e) => e.key);
    if (!keys.length) return;

    const isDeleteAll = selectedKeys.size === 0;
    const confirmed = await confirmDanger({
      title: isDeleteAll ? "Delete All Cache Keys?" : "Delete Selected Cache Keys?",
      html: `You are deleting <strong>${keys.length}</strong> key(s).`,
      confirmText: isDeleteAll ? "Delete All" : "Delete Selected",
    });
    if (!confirmed) return;

    setBulkDeleting(true);
    try {
      const json = await bulkDeletePortalCacheEntries(token, keys);
      toast(json?.message || "Cache keys deleted", "success");
      await load(patternRef.current);
    } catch (err) {
      toast((err as Error).message || "Bulk delete failed", "error");
    } finally {
      setBulkDeleting(false);
    }
  };

  const cacheAllCount = entries.length;
  const cacheSelectedCount = selectedKeys.size;
  const bulkDeleteLabel =
    cacheAllCount === 0
      ? "Delete All"
      : cacheSelectedCount > 0
        ? `Delete Selected (${cacheSelectedCount})`
        : "Delete All";

  return (
    <>
      <div className="section-header">
        <div>
          <div className="section-title">Cache Settings</div>
          <div className="section-subtitle">
            {canDelete
              ? "Manage cache keys and inspect Redis data"
              : "Read-only view of cached Redis keys"}
          </div>
        </div>
        {canDelete && (
          <button
            className="btn btn-danger"
            disabled={cacheAllCount === 0 || bulkDeleting}
            onClick={handleBulkDelete}
          >
            <i className="fa-solid fa-trash" /> {bulkDeleteLabel}
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-body">
          <CacheTable
            entries={entries}
            loading={loading}
            selectedKeys={selectedKeys}
            onSelectionChange={setSelectedKeys}
            canDelete={canDelete}
            onView={openDetail}
            onDelete={deleteKey}
            onSearch={handleSearch}
            empty={
              <div className="dt2-empty">
                <div className="dt2-empty-icon">
                  <i className="fa-solid fa-database" aria-hidden="true" />
                </div>
                {/* The portal is served only the entries tied to this user's
                    own environments (src/utils/portalCacheScope.js), so an
                    empty table says that rather than implying nothing is
                    cached anywhere. */}
                <h3>No cache entries for your environments</h3>
                <p>
                  Nothing cached for the environments you own matches this pattern.
                  Shared entries are not listed here.
                </p>
              </div>
            }
          />
        </div>
      </div>

      {/* ════════════ CACHE DETAIL MODAL ════════════ */}
      <div
        className={`modal-backdrop${detailKey ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDetail();
        }}
      >
        <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">
              <i className="fa-solid fa-database" />
              <span>Cache Key Details</span>
            </div>
            <button className="modal-close" aria-label="Close" onClick={closeDetail}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>

          <div className="modal-body">
            <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
              <div>
                <strong>Key:</strong> <span>{detailKey || "—"}</span>
              </div>
              <div>
                <strong>Type:</strong>{" "}
                <span>
                  {detail
                    ? `${detail.redis_type || "unknown"} / ${detail.value_type || "unknown"}`
                    : detailLoading
                      ? "Loading…"
                      : "—"}
                </span>
                <span style={{ marginLeft: 12 }}>
                  <strong>TTL:</strong>{" "}
                  <span>{detail ? detail.ttl_label || "Unavailable" : detailLoading ? "Loading…" : "—"}</span>
                </span>
              </div>
            </div>
            <div className="cache-value">
              {detail ? safeStringify(detail.value) : detailLoading ? "Loading…" : "—"}
            </div>
          </div>

          <div className="modal-footer" style={{ justifyContent: "space-between" }}>
            {canDelete && detailKey ? (
              <button className="btn btn-danger" onClick={() => deleteKey(detailKey)}>
                <i className="fa-solid fa-trash" /> Delete This Key
              </button>
            ) : (
              <span />
            )}
            <button className="btn btn-ghost" onClick={closeDetail}>
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
