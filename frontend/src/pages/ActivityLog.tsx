import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getActivityConfig,
  getActivitySummary,
  listActivity,
  type ActivityConfig,
  type ActivityRow,
  type ActivitySummary,
  type Surface,
} from "../lib/activityLogApi";
import type { AdminEnvironment } from "../lib/adminApi";
import { toast } from "../lib/notify";
import AdminSelect from "../components/AdminSelect";
import "./ActivityLog.css";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 10;

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

const CATEGORY_LABEL: Record<string, string> = {
  campaign: "Campaign",
  channel: "Channel",
  task: "Task",
  token: "Token service",
  master: "Master",
  amoeba: "Service",
  mcp: "MCP",
};

const categoryLabel = (c: string | null) =>
  (c && CATEGORY_LABEL[c]) || c || "—";

/** Pretty-print a JSON value (objects → 2-space indented JSON). */
const prettyJson = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

/** A request/response payload block inside the call-details modal. */
function ActivityPayloadBlock({ title, payload }: { title: string; payload: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = payload === null || payload === undefined ? "" : prettyJson(payload);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div className="al-payload-block">
      <div className="al-payload-head">
        <span>{title}</span>
        {text ? (
          <button type="button" className="al-copy-btn" onClick={copy}>
            <i className={`fa-solid ${copied ? "fa-check" : "fa-copy"}`} />{" "}
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
      {text ? (
        <pre className="al-json">{text}</pre>
      ) : (
        <div className="al-no-payload">No {title.toLowerCase()} captured.</div>
      )}
    </div>
  );
}

interface Props {
  environments: AdminEnvironment[];
  active: boolean;
}

/**
 * Who called the API/MCP surface, what they called, and whether the
 * security gates let it through — filtered, paginated, and explicitly not
 * kept forever. Every row here ages out on its own; see the retention note
 * in the header, sourced from the same config the background sweep reads.
 */
export default function ActivityLog({ environments, active }: Props) {
  const [config, setConfig] = useState<ActivityConfig | null>(null);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [detailRow, setDetailRow] = useState<ActivityRow | null>(null);

  const [envFilter, setEnvFilter] = useState("");
  const [surfaceFilter, setSurfaceFilter] = useState<Surface | "">("");
  const [resultFilter, setResultFilter] = useState<"allowed" | "denied" | "">("");
  const [emailFilter, setEmailFilter] = useState("");

  const loadedOnce = useRef(false);
  const searchDebounce = useRef<number | null>(null);

  const load = useCallback(
    async (nextOffset = offset) => {
      setLoading(true);
      try {
        const [list, sum] = await Promise.all([
          listActivity({
            env_id: envFilter || undefined,
            surface: surfaceFilter || undefined,
            allowed: resultFilter ? resultFilter === "allowed" : undefined,
            actor_email: emailFilter.trim() || undefined,
            limit: pageSize,
            offset: nextOffset,
          }),
          getActivitySummary(envFilter || undefined),
        ]);
        setRows(list.rows);
        setTotal(list.total);
        setSummary(sum);
        setOffset(nextOffset);
      } catch (err: any) {
        toast(err?.message || "Could not load the activity log", "error");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [envFilter, surfaceFilter, resultFilter, emailFilter, pageSize],
  );

  useEffect(() => {
    if (!active) return;
    if (!loadedOnce.current) {
      loadedOnce.current = true;
      getActivityConfig().then(setConfig).catch(() => {});
    }
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, envFilter, surfaceFilter, resultFilter, pageSize]);

  // Email search is free text — debounce it instead of firing on every
  // keystroke.
  useEffect(() => {
    if (!active) return;
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

  return (
    <>
      <div className="section-header">
        <div>
          <div className="section-title">Activity Log</div>
          <div className="section-subtitle">
            Every API and MCP call: who called, what they called, and whether it was let through
          </div>
        </div>
        {config && (
          <span className="al-retention" title="Older rows are purged automatically">
            <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
            Kept for {config.retention_days} day{config.retention_days === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="stats-grid al-stats">
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

      <div className="al-filterbar">
        <div className="al-search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by caller email…"
            value={emailFilter}
            onChange={(e) => setEmailFilter(e.target.value)}
            aria-label="Search by caller email"
          />
        </div>

        <div className="al-env-select">
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

        <div className="al-chipgroup" role="group" aria-label="Filter by surface">
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
              className="al-chip"
              aria-pressed={surfaceFilter === opt.value}
              onClick={() => setSurfaceFilter(opt.value as Surface | "")}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="al-chipgroup" role="group" aria-label="Filter by result">
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
              className={`al-chip${
                opt.value === "denied"
                  ? " al-chip-danger"
                  : opt.value === "allowed"
                    ? " al-chip-success"
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

      <div className="ea-table-card">
        {/* Rows-per-page + live count range, so admins can size the audit
            log to their reading pace without losing count context. */}
        <div className="al-toolbar">
          <span className="al-range" aria-live="polite">
            {loading
              ? "Loading…"
              : total === 0
                ? "No calls"
                : `Showing ${rangeFrom}–${rangeTo} of ${total}`}
          </span>
          <label className="al-pagesize">
            Show
            <select
              className="al-pagesize-select"
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
        <div className="ea-scroll">
          <table className="ea-table al-table">
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
                  <tr className="ea-skeleton-row" key={i}>
                    <td colSpan={6}>
                      <div className="ea-skeleton" />
                    </td>
                  </tr>
                ))}

              {!loading &&
                rows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={`al-row-in al-row-clickable ${row.allowed ? "al-row-allowed" : "al-row-denied"}`}
                    style={{ "--row-index": Math.min(i, 12) } as React.CSSProperties}
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
                    <td className="al-time">{formatTime(row.created_at)}</td>
                    <td className="al-caller">
                      {row.actor_email || (
                        <span className="al-unresolved">
                          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                          Unresolved
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`al-surface-badge al-surface-${row.surface}`}>
                        {row.surface === "mcp" ? "MCP" : "API"}
                      </span>
                    </td>
                    <td className="al-called">
                      {row.method && <span className="al-method">{row.method}</span>}
                      <code>{row.resource}</code>
                    </td>
                    <td className="al-ip">
                      {row.ip ? (
                        <code className="al-ip-code">{row.ip}</code>
                      ) : (
                        <span className="al-muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className="al-result" title={codeLabel(row.code)}>
                        <span
                          className={`al-result-icon ${row.allowed ? "al-result-allow" : "al-result-deny"}`}
                        >
                          <i
                            className={`fa-solid ${row.allowed ? "fa-check" : "fa-xmark"}`}
                            aria-hidden="true"
                          />
                        </span>
                        <span className="al-result-text">
                          {row.allowed ? "Allowed" : "Denied"}
                          {row.status_code != null && (
                            <span className="al-status">{row.status_code}</span>
                          )}
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {!loading && rows.length === 0 && (
          <div className="ea-empty">
            <div className="ea-empty-icon">
              <i className="fa-solid fa-list-check" />
            </div>
            <div className="ea-empty-title">No calls match these filters</div>
            <div className="ea-empty-desc">
              Once a call comes through the API or MCP surface, it shows up here in real time.
            </div>
          </div>
        )}

        {!loading && (
          <div className="al-pagination">
            <span className="al-pageinfo">Page {page} of {pageCount}</span>
            <nav className="al-page-numbers" aria-label="Pagination">
              <button
                type="button"
                className="al-page-arrow"
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
                    className={`al-page-btn${item === page ? " current" : ""}`}
                    aria-current={item === page ? "page" : undefined}
                    onClick={() => load((item - 1) * pageSize)}
                  >
                    {item}
                  </button>
                ) : (
                  <span key={`gap-${idx}`} className="al-page-ellipsis" aria-hidden="true">
                    …
                  </span>
                ),
              )}
              <button
                type="button"
                className="al-page-arrow"
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
                <span className={`al-surface-badge al-surface-${detailRow.surface}`} style={{ marginLeft: 8 }}>
                  {detailRow.surface === "mcp" ? "MCP" : "API"}
                </span>
              </div>
              <button className="modal-close" onClick={() => setDetailRow(null)} aria-label="Close">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="modal-body">
              <dl className="al-detail-grid">
                <div>
                  <dt>Time</dt>
                  <dd>{formatTime(detailRow.created_at)}</dd>
                </div>
                <div>
                  <dt>Caller</dt>
                  <dd>
                    {detailRow.actor_email || (
                      <span className="al-muted">Unresolved</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Environment</dt>
                  <dd>{detailRow.environment_name || "—"}</dd>
                </div>
                <div>
                  <dt>IP address</dt>
                  <dd>
                    {detailRow.ip ? (
                      <code className="al-ip-code">{detailRow.ip}</code>
                    ) : (
                      <span className="al-muted">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Category</dt>
                  <dd>{categoryLabel(detailRow.category)}</dd>
                </div>
                <div>
                  <dt>Action</dt>
                  <dd>{detailRow.action || "—"}</dd>
                </div>
                <div>
                  <dt>Method</dt>
                  <dd>{detailRow.method || "—"}</dd>
                </div>
                <div className="al-detail-resource">
                  <dt>Resource</dt>
                  <dd>
                    <code>{detailRow.resource}</code>
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{detailRow.status_code ?? "—"}</dd>
                </div>
                <div>
                  <dt>Result</dt>
                  <dd>
                    <span className="al-result-text">
                      {detailRow.allowed ? "Allowed" : "Denied"}
                    </span>
                    {detailRow.code ? (
                      <span className="al-status" title={codeLabel(detailRow.code)}>
                        {detailRow.code}
                      </span>
                    ) : null}
                  </dd>
                </div>
              </dl>

              <ActivityPayloadBlock title="Request payload" payload={detailRow.request_payload} />
              <ActivityPayloadBlock title="Response payload" payload={detailRow.response_payload} />
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
