import { useEffect, useState } from "react";
import { getPortalToken } from "../lib/portalAuthApi";
import {
  deletePortalCacheEntry,
  getPortalCacheDetail,
  listPortalCacheEntries,
  type PortalCacheDetail,
  type PortalCacheEntry,
} from "../lib/portalCacheApi";
import { RowMenu } from "../components/ui/RowMenu";

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// Portal counterpart of the admin console's Cache Settings page — the same
// browse/inspect/delete surface (GET/DELETE /api/v1/portal/cache*), gated by
// the "cache" permission module (read to browse, delete to clear a key; no
// bulk-delete on the portal side — src/utils/portalPermissionCatalog.js).
export default function PortalCachePage({
  active,
  canDelete,
}: {
  active: boolean;
  canDelete: boolean;
}) {
  const token = getPortalToken();
  const [pattern, setPattern] = useState("");
  const [entries, setEntries] = useState<PortalCacheEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<PortalCacheDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = async (searchPattern: string) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listPortalCacheEntries(token, searchPattern);
      setEntries(data);
    } catch (err) {
      setError((err as Error).message || "Failed to load cache entries");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    load(pattern.trim());
  };

  const openDetail = async (key: string) => {
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
  };

  const closeDetail = () => {
    setDetailKey(null);
    setDetail(null);
  };

  const handleDelete = async (key: string) => {
    if (!token) return;
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
  };

  return (
    <>
      <div className="section-header">
        <div>
          <div className="section-title">Cache Settings</div>
          <div className="section-subtitle">
            {canDelete ? "Browse and clear cached Redis keys" : "Read-only view of cached Redis keys"}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <form onSubmit={handleSearch} style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <input
              type="text"
              className="form-control"
              placeholder="Search keys, or use a wildcard e.g. datahub:*"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary btn-sm" type="submit">
              <i className="fa-solid fa-magnifying-glass" /> Search
            </button>
            {pattern && (
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => {
                  setPattern("");
                  load("");
                }}
              >
                Clear
              </button>
            )}
          </form>

          {error && (
            <div className="empty-state">
              <div className="empty-state-icon">
                <i className="fa-solid fa-triangle-exclamation" />
              </div>
              <h3>Couldn't load cache entries</h3>
              <p>{error}</p>
            </div>
          )}

          {!error && !loading && entries.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">
                <i className="fa-regular fa-folder-open" />
              </div>
              <h3>No matching keys</h3>
              <p>Try a different search term or wildcard pattern.</p>
            </div>
          )}

          {!error && entries.length > 0 && (
            <div className="table-wrapper" style={{ overflowX: "auto" }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Type</th>
                    <th>TTL</th>
                    <th>Size</th>
                    <th>Preview</th>
                    {canDelete && <th style={{ width: 64, textAlign: "center" }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.key}>
                      <td style={{ cursor: "pointer" }} onClick={() => openDetail(entry.key)}>
                        <code style={{ fontSize: 11 }}>{entry.key}</code>
                      </td>
                      <td style={{ cursor: "pointer" }} onClick={() => openDetail(entry.key)}>
                        {entry.redis_type}
                      </td>
                      <td style={{ cursor: "pointer" }} onClick={() => openDetail(entry.key)}>
                        {entry.ttl_label}
                      </td>
                      <td style={{ cursor: "pointer" }} onClick={() => openDetail(entry.key)}>
                        {entry.size_bytes} B
                      </td>
                      <td
                        style={{
                          maxWidth: 320,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                        }}
                        onClick={() => openDetail(entry.key)}
                      >
                        {entry.preview}
                      </td>
                      {canDelete && (
                        <td style={{ textAlign: "center" }}>
                          <RowMenu
                            label={`Actions for ${entry.key}`}
                            items={[
                              {
                                label: "View",
                                icon: "fa-solid fa-eye",
                                onSelect: () => openDetail(entry.key),
                              },
                              {
                                label: "Delete",
                                icon: "fa-solid fa-trash",
                                danger: true,
                                onSelect: () => handleDelete(entry.key),
                              },
                            ]}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ════════════ KEY DETAIL MODAL ════════════ */}
      <div
        className={`modal-backdrop${detailKey ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDetail();
        }}
      >
        <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">
              <i className="fa-solid fa-database" />
              <span>{detailKey}</span>
            </div>
            <button className="modal-close" onClick={closeDetail}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
          <div className="modal-body">
            {detailLoading && <p style={{ color: "var(--text-muted)" }}>Loading…</p>}
            {!detailLoading && detail && (
              <>
                <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
                  <div>
                    <div className="form-label">Type</div>
                    <div>{detail.redis_type}</div>
                  </div>
                  <div>
                    <div className="form-label">TTL</div>
                    <div>{detail.ttl_label}</div>
                  </div>
                  <div>
                    <div className="form-label">Value type</div>
                    <div>{detail.value_type}</div>
                  </div>
                </div>
                <div className="form-label">Value</div>
                <pre
                  style={{
                    background: "var(--bg-surface)",
                    padding: 12,
                    borderRadius: "var(--radius-sm)",
                    fontSize: 12,
                    overflow: "auto",
                    maxHeight: 320,
                  }}
                >
                  {safeStringify(detail.value)}
                </pre>
              </>
            )}
          </div>
          <div className="modal-footer">
            {canDelete && detailKey && (
              <button
                className="btn btn-danger"
                onClick={() => handleDelete(detailKey)}
                style={{ marginRight: "auto" }}
              >
                <i className="fa-solid fa-trash" /> Delete
              </button>
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
