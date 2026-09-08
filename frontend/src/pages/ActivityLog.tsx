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

const PAGE_SIZE = 25;

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
            limit: PAGE_SIZE,
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
    [envFilter, surfaceFilter, resultFilter, emailFilter],
  );

  useEffect(() => {
    if (!active) return;
    if (!loadedOnce.current) {
      loadedOnce.current = true;
      getActivityConfig().then(setConfig).catch(() => {});
    }
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, envFilter, surfaceFilter, resultFilter]);

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

  const envName = useMemo(
    () => Object.fromEntries(environments.map((e) => [e.id, e.environment_name])),
    [environments],
  );

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
        <div className="ea-scroll">
          <table className="ea-table al-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Caller</th>
                <th scope="col">Environment</th>
                <th scope="col">Surface</th>
                <th scope="col">Called</th>
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
                    className={`al-row-in ${row.allowed ? "al-row-allowed" : "al-row-denied"}`}
                    style={{ "--row-index": Math.min(i, 12) } as React.CSSProperties}
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
                      {row.environment_name || envName[row.env_id || ""] || (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
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

        {!loading && total > PAGE_SIZE && (
          <div className="al-pagination">
            <span>
              Page {page} of {pageCount} · {total} total
            </span>
            <div className="al-pagination-buttons">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={offset === 0}
                onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
              >
                <i className="fa-solid fa-chevron-left" /> Previous
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => load(offset + PAGE_SIZE)}
              >
                Next <i className="fa-solid fa-chevron-right" />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
