import { useEffect, useMemo, useState } from "react";
import { getPortalToken } from "../lib/portalAuthApi";
import {
  getPortalActivitySummary,
  listPortalActivity,
  type PortalActivityFilters,
  type PortalActivityRow,
  type PortalActivitySummary,
  type PortalSurface,
} from "../lib/portalActivityApi";
import { formatDateTime } from "../lib/format";

function AllowedBadge({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <span className="badge badge-success">
      <span className="dot" /> Allowed
    </span>
  ) : (
    <span className="badge badge-danger">
      <span className="dot" /> Denied
    </span>
  );
}

const PAGE_SIZE = 25;

// Read-only portal counterpart of the admin console's Activity Logs page —
// same data (GET /api/v1/portal/activity-logs, gated by the "activity_logs"
// permission module instead of verifyAdminJWT), no write actions since the
// module only ever grants "read" (src/utils/portalPermissionCatalog.js).
export default function PortalActivityPage({ active }: { active: boolean }) {
  const token = getPortalToken();
  const [rows, setRows] = useState<PortalActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<PortalActivitySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const [actorEmail, setActorEmail] = useState("");
  const [surface, setSurface] = useState<PortalSurface | "">("");
  const [allowed, setAllowed] = useState<"" | "true" | "false">("");

  const filters: PortalActivityFilters = useMemo(
    () => ({
      actor_email: actorEmail.trim() || undefined,
      surface: surface || undefined,
      allowed: allowed === "" ? undefined : allowed === "true",
      limit: PAGE_SIZE,
      offset,
    }),
    [actorEmail, surface, allowed, offset],
  );

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [list, sum] = await Promise.all([
        listPortalActivity(token, filters),
        getPortalActivitySummary(token),
      ]);
      setRows(list.rows);
      setTotal(list.total);
      setSummary(sum);
    } catch (err) {
      setError((err as Error).message || "Failed to load activity");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, filters]);

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
  };

  const clearFilters = () => {
    setActorEmail("");
    setSurface("");
    setAllowed("");
    setOffset(0);
  };

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="section-header">
        <div>
          <div className="section-title">Activity Logs</div>
          <div className="section-subtitle">Read-only view of recent API and MCP calls</div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card blue">
          <div className="stat-icon blue">
            <i className="fa-solid fa-list" />
          </div>
          <div className="stat-body">
            <div className="stat-value">{summary ? summary.total : "—"}</div>
            <div className="stat-label">Total Calls</div>
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

      <div className="card">
        <div className="card-body">
          <form
            onSubmit={applyFilters}
            style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 16 }}
          >
            <div className="form-group" style={{ minWidth: 200, marginBottom: 0 }}>
              <label className="form-label" htmlFor="actFilterEmail">
                Actor email
              </label>
              <input
                id="actFilterEmail"
                type="text"
                className="form-control"
                placeholder="name@company.com"
                value={actorEmail}
                onChange={(e) => setActorEmail(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ minWidth: 140, marginBottom: 0 }}>
              <label className="form-label" htmlFor="actFilterSurface">
                Surface
              </label>
              <select
                id="actFilterSurface"
                className="form-control"
                value={surface}
                onChange={(e) => setSurface(e.target.value as PortalSurface | "")}
              >
                <option value="">All</option>
                <option value="rest">REST</option>
                <option value="mcp">MCP</option>
              </select>
            </div>
            <div className="form-group" style={{ minWidth: 140, marginBottom: 0 }}>
              <label className="form-label" htmlFor="actFilterAllowed">
                Outcome
              </label>
              <select
                id="actFilterAllowed"
                className="form-control"
                value={allowed}
                onChange={(e) => setAllowed(e.target.value as "" | "true" | "false")}
              >
                <option value="">All</option>
                <option value="true">Allowed</option>
                <option value="false">Denied</option>
              </select>
            </div>
            <button className="btn btn-primary btn-sm" type="submit">
              <i className="fa-solid fa-filter" /> Apply
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={clearFilters}>
              Clear
            </button>
          </form>

          {error && (
            <div className="empty-state">
              <div className="empty-state-icon">
                <i className="fa-solid fa-triangle-exclamation" />
              </div>
              <h3>Couldn't load activity</h3>
              <p>{error}</p>
            </div>
          )}

          {!error && !loading && rows.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">
                <i className="fa-regular fa-folder-open" />
              </div>
              <h3>No activity found</h3>
              <p>No calls matched these filters yet.</p>
            </div>
          )}

          {!error && rows.length > 0 && (
            <div className="table-wrapper" style={{ overflowX: "auto" }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Actor</th>
                    <th>Environment</th>
                    <th>Surface</th>
                    <th>Resource</th>
                    <th>Method</th>
                    <th>Outcome</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.created_at)}</td>
                      <td>{row.actor_email || "—"}</td>
                      <td>{row.environment_name || "—"}</td>
                      <td style={{ textTransform: "uppercase" }}>{row.surface}</td>
                      <td>
                        <code style={{ fontSize: 11 }}>{row.resource}</code>
                      </td>
                      <td>{row.method || "—"}</td>
                      <td>
                        <AllowedBadge allowed={row.allowed} />
                      </td>
                      <td>{row.status_code ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!error && total > PAGE_SIZE && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 16,
                fontSize: 13,
                color: "var(--text-muted)",
              }}
            >
              <span>
                Page {page} of {pageCount} &middot; {total} total
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  ‹ Previous
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next ›
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
