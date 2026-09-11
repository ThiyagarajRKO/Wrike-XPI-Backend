import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPortalToken } from "../lib/portalAuthApi";
import {
  deletePortalCacheEntry,
  getPortalCacheDetail,
  listPortalCacheEntries,
  type PortalCacheDetail,
  type PortalCacheEntry,
} from "../lib/portalCacheApi";
import { DataTable } from "../components/ui/DataTable";
import { useTable, type ColumnDef } from "../components/ui/useTable";
import { RowMenu } from "../components/ui/RowMenu";
import { Badge } from "../components/ui/Badge";
import { formatBytes } from "../lib/format";
import "./PortalCachePage.css";

/* The portal Cache Settings page.
 *
 * The same page as the admin console's Cache Settings
 * (frontend/src/pages/admin/CacheTable.tsx inside a card): the shared
 * DataTable/useTable stack, the shared RowMenu for row actions, and the same
 * key-detail modal. What differs is enforced by the portal API, not chosen
 * here:
 *
 *   - No bulk delete. src/routes/portal/cache/index.js only exposes a
 *     single-key DELETE; the "cache" portal-permission module
 *     (src/utils/portalPermissionCatalog.js) grants "read" and "delete", not
 *     a separate bulk action, so keys are cleared one at a time.
 *   - CRUD gating. "cache:read" gets the page and the View action;
 *     "cache:delete" is what adds the Delete action — to the row menu and to
 *     the detail modal. Without it the page is a browsable, read-only
 *     inspector, and no control is shown that would 403.
 *   - Server-side search, because the pattern is a Redis key glob: filtering
 *     client-side would only narrow the page already fetched, so the search
 *     box is debounced into the query exactly as the admin table's is.
 */

const SEARCH_DEBOUNCE_MS = 350;

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
  const [pattern, setPattern] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<PortalCacheDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(
    async (nextPattern: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const data = await listPortalCacheEntries(token, nextPattern);
        setEntries(data);
      } catch (err) {
        setEntries([]);
        setError((err as Error).message || "Failed to load cache entries");
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
        setError((err as Error).message || "Failed to load key detail");
      } finally {
        setDetailLoading(false);
      }
    },
    [token],
  );

  const handleDelete = useCallback(
    async (key: string) => {
      if (!token || !canDelete) return;

      const Swal = window.Swal;
      const result = Swal
        ? await Swal.fire({
            title: "Delete this cache key?",
            html: `<code>${key}</code> will be removed immediately. This cannot be undone.`,
            icon: "warning",
            showCancelButton: true,
            confirmButtonText: "Delete",
            cancelButtonText: "Cancel",
            reverseButtons: true,
            customClass: { confirmButton: "swal2-confirm swal2-danger" },
          })
        : { isConfirmed: true };

      if (!result.isConfirmed) return;

      try {
        await deletePortalCacheEntry(token, key);
        if (detailKey === key) closeDetail();
        await load(pattern.trim());
      } catch (err) {
        setError((err as Error).message || "Failed to delete cache key");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, canDelete, detailKey, pattern, load, closeDetail],
  );

  const columns = useMemo<ColumnDef<PortalCacheEntry>[]>(() => {
    const cols: ColumnDef<PortalCacheEntry>[] = [
      {
        id: "key",
        header: "Key",
        accessor: (entry) => entry.key,
        cell: (entry) => (
          <span className="pca-key" title={entry.key}>
            {entry.key}
          </span>
        ),
      },
      {
        id: "redis_type",
        header: "Type",
        accessor: (entry) => entry.redis_type,
        cell: (entry) => <Badge tone="neutral">{entry.redis_type || "unknown"}</Badge>,
      },
      {
        id: "ttl",
        header: "TTL",
        accessor: (entry) => entry.ttl_label,
        cell: (entry) => entry.ttl_label || "Unavailable",
      },
      {
        id: "size_bytes",
        header: "Size",
        accessor: (entry) => entry.size_bytes,
        cell: (entry) => formatBytes(entry.size_bytes),
        searchable: false,
      },
      {
        // Always present: every caller who can see this page holds
        // "cache:read", so View is always an available action. Delete is
        // appended only when the matrix grants "cache:delete".
        id: "actions",
        header: "Actions",
        width: "64px",
        align: "center",
        cell: (entry) => (
          <RowMenu
            label={`Actions for ${entry.key}`}
            items={[
              {
                label: "View",
                icon: "fa-solid fa-eye",
                onSelect: () => openDetail(entry.key),
              },
              ...(canDelete
                ? [
                    {
                      label: "Delete",
                      icon: "fa-solid fa-trash",
                      danger: true,
                      onSelect: () => handleDelete(entry.key),
                    },
                  ]
                : []),
            ]}
          />
        ),
      },
    ];

    return cols;
  }, [canDelete, openDetail, handleDelete]);

  const table = useTable({
    data: entries,
    columns,
    getRowId: (entry) => entry.key,
    initialPageSize: 10,
    clientSearch: false,
  });

  /* Debounce the search box into the server query. The ref guard keeps the
     first render from firing a redundant fetch for the empty pattern the
     activation effect has already loaded. */
  const { search } = table;
  const primedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    if (!primedRef.current) {
      primedRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      setPattern(search.trim());
      load(search.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, load, active]);

  return (
    <>
      <div className="section-header">
        <div>
          <div className="section-title">Cache Settings</div>
          <div className="section-subtitle">
            {canDelete
              ? "Browse and clear cached Redis keys"
              : "Read-only view of cached Redis keys"}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <DataTable
            table={table}
            caption="Cache keys"
            loading={loading}
            pageSizeOptions={[10, 25, 50, 100]}
            searchPlaceholder="Search cache keys or patterns…"
            toolbar={
              <span className="pca-meta">
                {entries.length} key{entries.length === 1 ? "" : "s"}
                {pattern ? (
                  <>
                    {" "}
                    matching <code>{pattern}</code>
                  </>
                ) : null}
              </span>
            }
            empty={
              error ? (
                <div className="dt2-empty">
                  <div className="dt2-empty-icon">
                    <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                  </div>
                  <h3>Couldn't load cache entries</h3>
                  <p>{error}</p>
                </div>
              ) : (
                <div className="dt2-empty">
                  <div className="dt2-empty-icon">
                    <i className="fa-solid fa-database" aria-hidden="true" />
                  </div>
                  <h3>No cache entries</h3>
                  <p>Nothing is cached for this pattern right now.</p>
                </div>
              )
            }
          />
        </div>
      </div>

      {/* ════════════ KEY DETAIL MODAL ════════════ */}
      <div
        className={`modal-backdrop${detailKey ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDetail();
        }}
      >
        <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
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
            {detailLoading && <p className="pca-modal-loading">Loading…</p>}

            {!detailLoading && detail && (
              <>
                <dl className="pca-detail-meta">
                  <div>
                    <dt>Key</dt>
                    <dd>
                      <code>{detail.key}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Type</dt>
                    <dd>
                      {detail.redis_type || "unknown"} / {detail.value_type || "unknown"}
                    </dd>
                  </div>
                  <div>
                    <dt>TTL</dt>
                    <dd>{detail.ttl_label || "Unavailable"}</dd>
                  </div>
                </dl>
                <pre className="pca-value">{safeStringify(detail.value)}</pre>
              </>
            )}
          </div>

          <div className="modal-footer" style={{ justifyContent: "space-between" }}>
            {canDelete && detailKey ? (
              <button className="btn btn-danger" onClick={() => handleDelete(detailKey)}>
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
