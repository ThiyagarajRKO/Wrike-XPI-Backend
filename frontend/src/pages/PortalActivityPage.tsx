import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getPortalToken } from "../lib/portalAuthApi";
import {
  getPortalActivityConfig,
  getPortalActivitySummary,
  listPortalActivity,
  type PortalActivityConfig,
  type PortalActivityRow,
  type PortalActivitySummary,
  type PortalSurface,
} from "../lib/portalActivityApi";
import { formatDateTime } from "../lib/format";
import AdminSelect from "../components/AdminSelect";
import "./PortalActivityPage.css";

/* The portal Activity Log.
 *
 * Deliberately the same page as the admin console's Activity Log
 * (frontend/src/pages/ActivityLog.tsx) — same retention pill, same filter
 * bar with its two chip groups, same table card, clickable rows opening the
 * same call-details modal, same numbered pager. The differences are all
 * consequences of the portal side of the API, not design choices:
 *
 *   - Read-only. The "activity_logs" portal-permission module only ever
 *     grants "read" (src/utils/portalPermissionCatalog.js), so there is no
 *     write action to render — the page says so once, in the header.
 *   - Row-level scoping. src/routes/portal/activity/index.js only lets a
 *     portal user query environments they own, so the environment filter is
 *     built from the caller's own environments and omitted entirely when
 *     they have none (or no permission to list them).
 */

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 10;

/* Same vocabulary the admin page uses, so a code means the same thing on
   both surfaces. Rendered as the row's tooltip, not a column. */
const CODE_LABEL: Record<string, string> = {
  ALLOWED: "Matched an allow-list entry",
  ALLOWED_GATE_DISABLED: "Allow-list check is off",
  NOT_ALLOWED: "No allow-list match",
  IDENTITY_UNAVAILABLE: "Could not verify the caller",
  ENVIRONMENT_UNKNOWN: "Token has no environment",
  AUTHORIZATION_ERROR: "Access could not be verified",
  UNAUTHORIZED: "No bearer token",
  TOKEN_INVALID: "Token invalid or expired",
  AUTH_FAILED: "Authentication failed",
};

const codeLabel = (code: string | null) => (code ? CODE_LABEL[code] || code : "—");

const CATEGORY_LABEL: Record<string, string> = {
  campaign: "Campaign",
  channel: "Channel",
  task: "Task",
  token: "Token service",
  master: "Master",
  amoeba: "Service",
  mcp: "MCP",
};

const categoryLabel = (c: string | null) => (c && CATEGORY_LABEL[c]) || c || "—";

/** Compact timestamp for the table — the modal prints the full one. */
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** The environments a portal user may filter by — a structural subset of
    PortalEnvironmentFull, so the caller doesn't have to pass anything more. */
export interface PortalActivityEnvironment {
  id: string;
  environment_name: string;
}

interface Props {
  active: boolean;
  environments: PortalActivityEnvironment[];
  /** Incremented by the shell's top-bar Refresh button to force a reload. */
  refreshKey?: number;
}

export default function PortalActivityPage({ active, environments, refreshKey = 0 }: Props) {
  const token = getPortalToken();

  const [config, setConfig] = useState<PortalActivityConfig | null>(null);
  const [summary, setSummary] = useState<PortalActivitySummary | null>(null);
  const [rows, setRows] = useState<PortalActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [detailRow, setDetailRow] = useState<PortalActivityRow | null>(null);

  const [envFilter, setEnvFilter] = useState("");
  const [surfaceFilter, setSurfaceFilter] = useState<PortalSurface | "">("");
  const [resultFilter, setResultFilter] = useState<"allowed" | "denied" | "">("");
  const [emailFilter, setEmailFilter] = useState("");

  const loadedOnce = useRef(false);
  const emailPrimed = useRef(false);
  const searchDebounce = useRef<number | null>(null);

  const load = useCallback(
    async (nextOffset = offset) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const [list, sum] = await Promise.all([
          listPortalActivity(token, {
            env_id: envFilter || undefined,
            surface: surfaceFilter || undefined,
            allowed: resultFilter ? resultFilter === "allowed" : undefined,
            actor_email: emailFilter.trim() || undefined,
            limit: pageSize,
            offset: nextOffset,
          }),
          getPortalActivitySummary(token, envFilter || undefined),
        ]);
        setRows(list.rows);
        setTotal(list.total);
        setSummary(sum);
        setOffset(nextOffset);
      } catch (err) {
        setError((err as Error).message || "Could not load the activity log");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, envFilter, surfaceFilter, resultFilter, emailFilter, pageSize],
  );

  useEffect(() => {
    if (!active || !token) return;
    if (!loadedOnce.current) {
      loadedOnce.current = true;
      getPortalActivityConfig(token).then(setConfig).catch(() => {});
    }
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, token, envFilter, surfaceFilter, resultFilter, pageSize]);

  // Top-bar Refresh — reload the current page (keeping filters and page) and
  // the summary stats without resetting the view.
  useEffect(() => {
    if (!active || refreshKey === 0) return;
    load(offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, refreshKey]);

  // Caller email is free text — debounce it instead of firing on every
  // keystroke. The ref guard keeps the first render from firing a second,
  // redundant fetch for the empty value the effect above already loaded.
  useEffect(() => {
    if (!active) return;
    if (!emailPrimed.current) {
      emailPrimed.current = true;
      return;
    }
    if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
    searchDebounce.current = window.setTimeout(() => load(0), 350);
    return () => {
      if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailFilter]);

  const page = Math.floor(offset / pageSize) + 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const rangeFrom = total === 0 ? 0 : offset + 1;
  const rangeTo = Math.min(offset + rows.length, total);

  // Numbered pager with ellipses for large result sets — stays compact and
  // readable even when the log spans many pages.
  const pageItems = useMemo<Array<number | "…">>(() => {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
    const items: Array<number | "…"> = [1];
    const left = Math.max(2, page - 2);
    const right = Math.min(pageCount - 1, page + 2);
    if (left > 2) items.push("…");
    for (let p = left; p <= right; p++) items.push(p);
    if (right < pageCount - 1) items.push("…");
    items.push(pageCount);
    return items;
  }, [page, pageCount]);

  const hasRows = !loading && !error && rows.length > 0;

  return (
    <>
      <div className="section-header">
        <div>
          <div className="section-title">Activity Log</div>
          <div className="section-subtitle">
            Every API and MCP call on your environments: who called, what they called, and whether
            it was let through
          </div>
        </div>
        <div className="pal-head-meta">
          <span className="pal-readonly" title="The activity log has no write actions">
            <i className="fa-solid fa-eye" aria-hidden="true" />
            Read-only
          </span>
          {config && (
            <span className="pal-retention" title="Older rows are purged automatically">
              <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
              Kept for {config.retention_days} day{config.retention_days === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      <div className="stats-grid pal-stats">
        <div className="stat-card blue">
          <div className="stat-icon blue">
            <i className="fa-solid fa-list-check" />
          </div>
          <div className="stat-body">
            <div className="stat-value">{summary ? summary.total : "—"}</div>
            <div className="stat-label">Calls</div>
          </div>
        </div>
        <div className="stat-card green">
          <div className="stat-icon green">
            <i className="fa-solid fa-circle-check" />
          </div>
          <div className="stat-body">
            <div className="stat-value">{summary ? summary.allowed : "—"}</div>
            <div className="stat-label">Allowed</div>
          </div>
        </div>
        <div className="stat-card red">
          <div className="stat-icon red">
            <i className="fa-solid fa-circle-xmark" />
          </div>
          <div className="stat-body">
            <div className="stat-value">{summary ? summary.denied : "—"}</div>
            <div className="stat-label">Denied</div>
          </div>
        </div>
      </div>

      <div className="pal-filterbar">
        <div className="pal-search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by caller email…"
            value={emailFilter}
            onChange={(e) => setEmailFilter(e.target.value)}
            aria-label="Search by caller email"
          />
        </div>

        {environments.length > 0 && (
          <div className="pal-env-select">
            <AdminSelect
              icon="fa-layer-group"
              ariaLabel="Filter by environment"
              value={envFilter}
              onChange={setEnvFilter}
              placeholder="All environments"
              options={[
                { value: "", label: "All environments" },
                ...environments.map((env) => ({ value: env.id, label: env.environment_name })),
              ]}
            />
          </div>
        )}

        <div className="pal-chipgroup" role="group" aria-label="Filter by surface">
          {(
            [
              { value: "", label: "All surfaces" },
              { value: "rest", label: "API" },
              { value: "mcp", label: "MCP" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value || "all"}
              type="button"
              className="pal-chip"
              aria-pressed={surfaceFilter === opt.value}
              onClick={() => setSurfaceFilter(opt.value as PortalSurface | "")}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="pal-chipgroup" role="group" aria-label="Filter by result">
          {(
            [
              { value: "", label: "All results" },
              { value: "allowed", label: "Allowed" },
              { value: "denied", label: "Denied" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value || "all"}
              type="button"
              className={`pal-chip${
                opt.value === "denied"
                  ? " pal-chip-danger"
                  : opt.value === "allowed"
                    ? " pal-chip-success"
                    : ""
              }`}
              aria-pressed={resultFilter === opt.value}
              onClick={() => setResultFilter(opt.value as "allowed" | "denied" | "")}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pal-table-card">
        {/* Rows-per-page + live count range, so the log can be sized to a
            reading pace without losing count context. */}
        <div className="pal-toolbar">
          <span className="pal-range" aria-live="polite">
            {loading
              ? "Loading…"
              : total === 0
                ? "No calls"
                : `Showing ${rangeFrom}–${rangeTo} of ${total}`}
          </span>
          <label className="pal-pagesize">
            Show
            <select
              className="pal-pagesize-select"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              aria-label="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            rows
          </label>
        </div>

        <div className="pal-scroll">
          <table className="pal-table">
            <caption className="pal-sr-only">Activity log</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Caller</th>
                <th scope="col">Surface</th>
                <th scope="col">Called</th>
                <th scope="col">IP</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr className="pal-skeleton-row" key={`skeleton-${i}`}>
                    <td colSpan={6}>
                      <div className="pal-skeleton" />
                    </td>
                  </tr>
                ))}

              {hasRows &&
                rows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={`pal-row-in pal-row-clickable ${
                      row.allowed ? "pal-row-allowed" : "pal-row-denied"
                    }`}
                    style={{ "--row-index": Math.min(i, 12) } as CSSProperties}
                    title="View call details"
                    tabIndex={0}
                    onClick={() => setDetailRow(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetailRow(row);
                      }
                    }}
                  >
                    <td className="pal-time">{formatTime(row.created_at)}</td>
                    <td className="pal-caller">
                      {row.actor_email || (
                        <span className="pal-unresolved">
                          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                          Unresolved
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`pal-surface-badge pal-surface-${row.surface}`}>
                        {row.surface === "mcp" ? "MCP" : "API"}
                      </span>
                    </td>
                    <td className="pal-called">
                      {row.method && <span className="pal-method">{row.method}</span>}
                      <code>{row.resource}</code>
                    </td>
                    <td className="pal-ip">
                      {row.ip ? (
                        <code className="pal-ip-code">{row.ip}</code>
                      ) : (
                        <span className="pal-muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className="pal-result" title={codeLabel(row.code)}>
                        <span
                          className={`pal-result-icon ${
                            row.allowed ? "pal-result-allow" : "pal-result-deny"
                          }`}
                        >
                          <i
                            className={`fa-solid ${row.allowed ? "fa-check" : "fa-xmark"}`}
                            aria-hidden="true"
                          />
                        </span>
                        <span className="pal-result-text">
                          {row.allowed ? "Allowed" : "Denied"}
                          {row.status_code != null && (
                            <span className="pal-status">{row.status_code}</span>
                          )}
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {error && (
          <div className="pal-empty">
            <div className="pal-empty-icon pal-empty-danger">
              <i className="fa-solid fa-triangle-exclamation" />
            </div>
            <div className="pal-empty-title">Couldn't load the activity log</div>
            <div className="pal-empty-desc">{error}</div>
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="pal-empty">
            <div className="pal-empty-icon">
              <i className="fa-solid fa-list-check" />
            </div>
            <div className="pal-empty-title">No calls match these filters</div>
            <div className="pal-empty-desc">
              Once a call comes through the API or MCP surface on your environments, it shows up
              here.
            </div>
          </div>
        )}

        {!loading && !error && total > 0 && (
          <div className="pal-pagination">
            <span className="pal-pageinfo">
              Page {page} of {pageCount}
            </span>
            <nav className="pal-page-numbers" aria-label="Activity log pagination">
              <button
                type="button"
                className="pal-page-arrow"
                disabled={page <= 1}
                aria-label="Previous page"
                onClick={() => load((page - 2) * pageSize)}
              >
                <i className="fa-solid fa-chevron-left" />
              </button>
              {pageItems.map((item, idx) =>
                typeof item === "number" ? (
                  <button
                    key={item}
                    type="button"
                    className={`pal-page-btn${item === page ? " current" : ""}`}
                    aria-current={item === page ? "page" : undefined}
                    onClick={() => load((item - 1) * pageSize)}
                  >
                    {item}
                  </button>
                ) : (
                  <span key={`gap-${idx}`} className="pal-page-ellipsis" aria-hidden="true">
                    …
                  </span>
                ),
              )}
              <button
                type="button"
                className="pal-page-arrow"
                disabled={page >= pageCount}
                aria-label="Next page"
                onClick={() => load(page * pageSize)}
              >
                <i className="fa-solid fa-chevron-right" />
              </button>
            </nav>
          </div>
        )}
      </div>

      {detailRow && (
        <div className="modal-backdrop open" onClick={() => setDetailRow(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Call details"
            style={{ maxWidth: 780 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title">
                <i className="fa-solid fa-magnifying-glass" /> Call details
                <span
                  className={`pal-surface-badge pal-surface-${detailRow.surface}`}
                  style={{ marginLeft: 8 }}
                >
                  {detailRow.surface === "mcp" ? "MCP" : "API"}
                </span>
              </div>
              <button className="modal-close" onClick={() => setDetailRow(null)} aria-label="Close">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="modal-body">
              <dl className="pal-detail-grid">
                <div>
                  <dt>Time</dt>
                  <dd>{formatDateTime(detailRow.created_at)}</dd>
                </div>
                <div>
                  <dt>Caller</dt>
                  <dd>{detailRow.actor_email || <span className="pal-muted">Unresolved</span>}</dd>
                </div>
                <div>
                  <dt>Environment</dt>
                  <dd>{detailRow.environment_name || "—"}</dd>
                </div>
                <div>
                  <dt>IP address</dt>
                  <dd>
                    {detailRow.ip ? (
                      <code className="pal-ip-code">{detailRow.ip}</code>
                    ) : (
                      <span className="pal-muted">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Category</dt>
                  <dd>{categoryLabel(detailRow.category)}</dd>
                </div>
                <div>
                  <dt>Outcome</dt>
                  <dd>
                    <span className="pal-result">
                      <span
                        className={`pal-result-icon ${
                          detailRow.allowed ? "pal-result-allow" : "pal-result-deny"
                        }`}
                      >
                        <i
                          className={`fa-solid ${detailRow.allowed ? "fa-check" : "fa-xmark"}`}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="pal-result-text">
                        {detailRow.allowed ? "Allowed" : "Denied"}
                        {detailRow.status_code != null && (
                          <span className="pal-status">{detailRow.status_code}</span>
                        )}
                      </span>
                    </span>
                  </dd>
                </div>
                <div className="pal-detail-resource">
                  <dt>Called</dt>
                  <dd>
                    <code>
                      {detailRow.method ? `${detailRow.method} ` : ""}
                      {detailRow.resource}
                    </code>
                  </dd>
                </div>
                <div className="pal-detail-resource">
                  <dt>Reason</dt>
                  <dd>{codeLabel(detailRow.code)}</dd>
                </div>
              </dl>
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDetailRow(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
