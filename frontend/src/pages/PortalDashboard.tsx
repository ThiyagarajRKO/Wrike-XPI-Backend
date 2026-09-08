import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearPortalSession,
  getPortalRole,
  getPortalToken,
  listPortalEnvironments,
  portalLogout,
  type PortalEnvironment,
} from "../lib/portalAuthApi";
import { useHashPage } from "../lib/useHashPage";
import "./PortalDashboard.css";

type PageId = "overview" | "environments";

const PAGE_NAMES: Record<PageId, string> = {
  overview: "Overview",
  environments: "Environments",
};

const PAGE_IDS = Object.keys(PAGE_NAMES) as PageId[];

/* ── Small shared helpers (ported 1:1 from the EJS <script>) ───────────── */

function decodeJwtPayload(token: string): { username?: string } | null {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

function formatLocalDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  try {
    const date = new Date(dateStr);
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return "--";
  }
}

function escHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // fall through to legacy fallback, same as the original page
  }
  const temp = document.createElement("input");
  document.body.appendChild(temp);
  temp.value = text;
  temp.select();
  document.execCommand("copy");
  document.body.removeChild(temp);
}

function toast(msg: string, type: "success" | "error" | "info" | "warning") {
  const palettes: Record<string, string> = {
    success: "linear-gradient(135deg, #0ecb81, #3fb950)",
    error: "linear-gradient(135deg, #f85149, #d03030)",
    info: "linear-gradient(135deg, #2f81f7, #6e40c9)",
    warning: "linear-gradient(135deg, #d29922, #e89e1d)",
  };
  const Toastify = window.Toastify;
  if (!Toastify) return;
  Toastify({
    text: msg,
    duration: 4500,
    gravity: "top",
    position: "right",
    stopOnFocus: true,
    style: {
      background: palettes[type] || palettes.info,
      borderRadius: "8px",
      fontFamily: "'Inter', sans-serif",
      fontSize: "13.5px",
      padding: "12px 18px",
      boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
      minWidth: "260px",
    },
  }).showToast();
}

function badgeHtml(active: boolean): string {
  return active
    ? '<span class="badge badge-success"><span class="dot"></span> Active</span>'
    : '<span class="badge badge-danger"><span class="dot"></span> Inactive</span>';
}

function visibilityBadgeHtml(visible: boolean): string {
  return visible
    ? '<span class="badge badge-success"><span class="dot"></span> Visible</span>'
    : '<span class="badge badge-warning"><span class="dot"></span> Hidden</span>';
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="badge badge-success">
      <span className="dot" /> Active
    </span>
  ) : (
    <span className="badge badge-danger">
      <span className="dot" /> Inactive
    </span>
  );
}

const ENV_TABLE_HEAD = `
  <thead>
    <tr>
      <th>Environment</th>
      <th>Env ID</th>
      <th>Created</th>
      <th>Last Updated</th>
      <th>Visibility</th>
      <th>Status</th>
    </tr>
  </thead>
`;

// Faithful React port of views/portal/dashboard.ejs.
export default function PortalDashboard() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activePage, setActivePage] = useHashPage<PageId>(PAGE_IDS, "overview");
  const [environments, setEnvironments] = useState<PortalEnvironment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const envTableContainerRef = useRef<HTMLDivElement>(null);
  const envDataTableRef = useRef<any>(null);

  const token = getPortalToken();

  /* ── Session guard ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!token) {
      window.location.replace("/portal/login");
    }
  }, [token]);

  /* ── Sidebar user info ─────────────────────────────────────────────── */
  const username = useMemo(() => {
    if (!token) return "User";
    return decodeJwtPayload(token)?.username || "User";
  }, [token]);

  const roleLabel = getPortalRole() === "admin" ? "Portal Admin" : "Portal User";

  /* ── Data loading ───────────────────────────────────────────────────── */
  const loadEnvironments = async () => {
    if (!token) return;
    window.NProgress?.start();
    try {
      const data = await listPortalEnvironments(token);
      setEnvironments(data);
    } catch (err) {
      toast("Failed to load environments", "error");
      console.error(err);
    } finally {
      setLoaded(true);
      window.NProgress?.done();
    }
  };

  useEffect(() => {
    window.NProgress?.configure({ showSpinner: false, minimum: 0.15 });
    loadEnvironments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const stats = useMemo(() => {
    const total = environments.length;
    const active = environments.filter((e) => e.is_active).length;
    const visible = environments.filter((e) => e.is_visible).length;
    return { total, active, inactive: total - active, visible };
  }, [environments]);

  const recentEnvs = environments.slice(0, 5);

  /* ── Environments table (DataTables) - imperative bridge ─────────────
     DataTables restructures its container's DOM heavily (detaches/re-wraps
     the filter, length, info and pagination controls). Handing it a
     container React never renders into keeps that restructuring from ever
     colliding with React's own reconciliation of the same nodes. */
  useEffect(() => {
    const $ = window.jQuery;
    const container = envTableContainerRef.current;
    if (!$ || !container || !loaded) return;

    if (envDataTableRef.current) {
      envDataTableRef.current.destroy();
      envDataTableRef.current = null;
    }

    const $container = $(container).empty();

    if (environments.length === 0) {
      $container.html(
        `<table class="dt" id="envTable">${ENV_TABLE_HEAD}<tbody>` +
          '<tr><td colspan="6">' +
          '<div class="empty-state">' +
          '<div class="empty-state-icon"><i class="fa-regular fa-folder-open"></i></div>' +
          "<h3>No environments found</h3>" +
          "<p>No Wrike environments have been assigned to you.</p>" +
          "</div>" +
          "</td></tr>" +
          "</tbody></table>",
      );
      return;
    }

    const rowsHtml = environments
      .map(
        (env) =>
          "<tr>" +
          "<td><strong>" +
          escHtml(env.environment_name) +
          "</strong></td>" +
          "<td>" +
          '<div class="action-cell">' +
          '<code style="font-size: 11px; color: var(--text-muted);">' +
          escHtml(env.id) +
          "</code>" +
          '<button class="icon-btn copy-id-btn" data-id="' +
          env.id +
          '" title="Copy ID">' +
          '<i class="fa-solid fa-copy"></i>' +
          "</button>" +
          "</div>" +
          "</td>" +
          "<td>" +
          formatLocalDate(env.created_at) +
          "</td>" +
          "<td>" +
          formatLocalDate(env.updated_at) +
          "</td>" +
          "<td>" +
          visibilityBadgeHtml(env.is_visible) +
          "</td>" +
          "<td>" +
          badgeHtml(env.is_active) +
          "</td>" +
          "</tr>",
      )
      .join("");

    $container.html(`<table class="dt" id="envTable">${ENV_TABLE_HEAD}<tbody>${rowsHtml}</tbody></table>`);

    envDataTableRef.current = $container.find("#envTable").DataTable({
      pageLength: 10,
      lengthMenu: [5, 10, 25, 50],
      order: [],
      columnDefs: [{ targets: 1, orderable: false, searchable: false }],
      language: {
        emptyTable: "No environments found",
        zeroRecords: "No matching environments",
        lengthMenu: "Show _MENU_ rows",
        search: "",
        searchPlaceholder: "Search environments…",
        info: "Showing _START_–_END_ of _TOTAL_",
        paginate: { previous: "‹", next: "›" },
      },
    });

    const layoutTimer = setTimeout(() => {
      const $wrapper = $container.find(".dataTables_wrapper");
      const $table = $wrapper.find("table");
      const $filter = $wrapper.find(".dataTables_filter");
      const $length = $wrapper.find(".dataTables_length");
      const $info = $wrapper.find(".dataTables_info");
      const $paginate = $wrapper.find(".dataTables_paginate");

      $table.detach();
      $filter.detach();
      $length.detach();
      $info.detach();
      $paginate.detach();

      const $scrollContainer = $('<div style="overflow-x: auto; min-width: 0; flex: 1;"></div>');
      $scrollContainer.append($table);

      const $topControls = $(
        '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 12px;"></div>',
      );
      $topControls.append($length);
      $topControls.append($filter);

      const $bottomControls = $(
        '<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; flex-wrap: wrap; gap: 12px;"></div>',
      );
      $bottomControls.append($info);
      $bottomControls.append($paginate);

      $wrapper.empty();
      $wrapper.append($topControls);
      $wrapper.append($scrollContainer);
      $wrapper.append($bottomControls);
    }, 10);

    return () => clearTimeout(layoutTimer);
  }, [environments, loaded]);

  /* Delegated click handler for the copy-id buttons DataTables owns. */
  useEffect(() => {
    const $ = window.jQuery;
    const container = envTableContainerRef.current;
    if (!$ || !container) return;

    const handler = function (this: HTMLElement, e: any) {
      e.preventDefault();
      e.stopPropagation();
      const $btn = $(this);
      const idValue = $btn.data("id");
      if (!idValue) return;
      copyToClipboard(String(idValue)).then(() => {
        const $icon = $btn.find("i");
        $icon.removeClass("fa-copy").addClass("fa-check");
        $btn.addClass("copied");
        setTimeout(() => {
          $icon.removeClass("fa-check").addClass("fa-copy");
          $btn.removeClass("copied");
        }, 1500);
      });
    };

    $(container).on("click", ".copy-id-btn", handler);
    return () => {
      $(container).off("click", ".copy-id-btn", handler);
    };
  }, []);

  /* ── Actions ────────────────────────────────────────────────────────── */
  const handleNav = (page: PageId) => {
    setActivePage(page);
    setMobileOpen(false);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadEnvironments().finally(() => {
      setTimeout(() => setRefreshing(false), 600);
    });
  };

  const handleCopyRecent = (id: string) => {
    copyToClipboard(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const handleLogout = async () => {
    const Swal = window.Swal;
    const result = Swal
      ? await Swal.fire({
          title: "Sign out?",
          html: "You will be logged out of the portal.",
          icon: "question",
          showCancelButton: true,
          confirmButtonText:
            '<i class="fa-solid fa-right-from-bracket" style="margin-right:6px"></i>Sign Out',
          cancelButtonText: "Stay",
          focusConfirm: false,
          reverseButtons: true,
          customClass: {
            confirmButton: "swal2-confirm",
            cancelButton: "swal2-cancel",
          },
        })
      : { isConfirmed: true };

    if (!result.isConfirmed) return;

    window.NProgress?.start();
    try {
      if (token) await portalLogout(token);
    } finally {
      clearPortalSession();
      window.location.replace("/portal/login");
    }
  };

  const pageTitle = PAGE_NAMES[activePage];

  return (
    <div id="app">
      {/* ═══════════ SIDEBAR ═══════════ */}
      <nav id="sidebar" className={`${collapsed ? "collapsed " : ""}${mobileOpen ? "mobile-open" : ""}`.trim()}>
        <div className="sidebar-logo-row">
          <a className="sidebar-logo" href="#">
            <div className="logo-mark">
              <svg viewBox="0 0 31 20" role="img" aria-label="Wrike symbol" aria-hidden="true">
                <path d="M20.78 1.404C21.885.298 22.587 0 24.113 0h6.878c.561 0 .684.509.35.842l-11.49 11.491c-.176.176-.246.21-.352.246-.035.018-.087.018-.122.018s-.088 0-.123-.018c-.106-.035-.176-.07-.351-.246L14.85 8.281c-.175-.176-.21-.246-.245-.351-.018-.035-.018-.088-.018-.123s0-.088.018-.123c.035-.105.07-.175.245-.35l5.93-5.93zM10.745 8.649C9.64 7.544 8.92 7.263 7.395 7.263H.534c-.562 0-.685.509-.351.842l11.49 11.492c.176.175.246.21.352.245a.299.299 0 00.123.018c.035 0 .087 0 .122-.018.105-.035.176-.07.351-.245l4.053-4.07c.175-.176.21-.246.245-.351a.3.3 0 00.018-.123c0-.035 0-.088-.018-.123-.035-.105-.07-.175-.245-.351l-5.93-5.93z" />
              </svg>
            </div>
            <div className="logo-text">
              <svg className="wrike-wordmark" viewBox="33 0 67 20" role="img" aria-label="Wrike">
                <path d="M71.064 4.72a1.965 1.965 0 100-3.93 1.965 1.965 0 000 3.93zm1.579 1.578h-3.158v11.035h3.158V6.298zm-9.877 11.035V12.37c0-3 2.649-2.948 4.035-2.72V6.263c-2.21-.193-3.526.421-4.123 1.614h-.07l.017-1.561h-3.07v11.018h3.21zm-22.685 0h2.474l3.79-7.087 3.666 7.087h2.509l5.632-11.035h-3.737l-3.456 7.035-3.281-7.035h-2.684l-3.456 7.07-3.281-7.07H34.52l5.561 11.035zm36.053 0h2l3.298-4.158 2.79 4.158h3.72l-4.387-6.386 3.842-4.649h-3.701l-4.386 5.544h-.07L79.275.79h-3.14v16.544zm18.228-2.368c1.351 0 2.158-.72 2.544-1.298l2.421 1.667c-.982 1.28-2.509 2.28-5.035 2.28-3.386 0-5.912-2.544-5.912-5.754 0-3.228 2.579-5.755 5.912-5.755 3.403 0 5.702 2.562 5.702 5.755v.877h-8.58c.246 1.316 1.37 2.228 2.948 2.228zm2.58-4.421c-.352-1.158-1.37-1.965-2.825-1.965-1.492 0-2.492.807-2.843 1.965h5.667z" />
              </svg>
              <span className="sub">Portal</span>
            </div>
          </a>
          <button
            className="sidebar-collapse-btn"
            title="Collapse sidebar"
            onClick={() => setCollapsed((v) => !v)}
          >
            <i className={`fa-solid ${collapsed ? "fa-chevron-right" : "fa-chevron-left"}`} />
          </button>
        </div>

        <div className="sidebar-nav">
          <div className="nav-group-label">Workspace</div>

          <div
            className={`nav-item${activePage === "overview" ? " active" : ""}`}
            onClick={() => handleNav("overview")}
          >
            <span className="ni">
              <i className="fa-solid fa-chart-pie" />
            </span>
            <span className="nl">Overview</span>
          </div>

          <div
            className={`nav-item${activePage === "environments" ? " active" : ""}`}
            onClick={() => handleNav("environments")}
          >
            <span className="ni">
              <i className="fa-solid fa-layer-group" />
            </span>
            <span className="nl">Environments</span>
            <span className="nav-badge">{environments.length}</span>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="user-row">
            <div className="user-row-left">
              <div className="user-avatar">{username.charAt(0).toUpperCase()}</div>
              <div className="user-meta">
                <div className="user-name">{username}</div>
                <div className="user-role">{roleLabel}</div>
              </div>
            </div>
            <button className="signout-icon-btn" title="Sign Out" onClick={handleLogout}>
              <i className="fa-solid fa-right-from-bracket" />
            </button>
          </div>
        </div>
      </nav>

      <div id="sidebar-overlay" onClick={() => setMobileOpen(false)} />

      {/* ═══════════ MAIN ═══════════ */}
      <div id="main">
        <div id="topbar">
          <div className="topbar-left">
            <div className="topbar-mobile-btn" onClick={() => setMobileOpen((v) => !v)}>
              <i className="fa-solid fa-bars" />
            </div>
            <div>
              <div className="page-title">{pageTitle}</div>
              <div className="breadcrumb">
                <span>Portal</span>
                <span className="bc-sep">/</span>
                <span>{pageTitle}</span>
              </div>
            </div>
          </div>
          <div className="topbar-right">
            <div className="topbar-icon-btn" title="Refresh data" onClick={handleRefresh}>
              <i className={`fa-solid fa-rotate-right${refreshing ? " fa-spin" : ""}`} />
            </div>
          </div>
        </div>

        <div id="content">
          {/* ══════ OVERVIEW PAGE ══════ */}
          <div className={`page${activePage === "overview" ? " active" : ""}`} id="page-overview">
            <div className="section-header">
              <div>
                <div className="section-title">Dashboard Overview</div>
                <div className="section-subtitle">
                  {loaded ? `Welcome back, ${username}` : "Welcome back"}
                </div>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card blue">
                <div className="stat-icon blue">
                  <i className="fa-solid fa-layer-group" />
                </div>
                <div className="stat-body">
                  <div className="stat-value">{loaded ? stats.total : "-"}</div>
                  <div className="stat-label">Total Environments</div>
                </div>
              </div>
              <div className="stat-card green">
                <div className="stat-icon green">
                  <i className="fa-solid fa-circle-check" />
                </div>
                <div className="stat-body">
                  <div className="stat-value">{loaded ? stats.active : "-"}</div>
                  <div className="stat-label">Active</div>
                </div>
              </div>
              <div className="stat-card red">
                <div className="stat-icon red">
                  <i className="fa-solid fa-circle-xmark" />
                </div>
                <div className="stat-body">
                  <div className="stat-value">{loaded ? stats.inactive : "-"}</div>
                  <div className="stat-label">Inactive</div>
                </div>
              </div>
              <div className="stat-card yellow">
                <div className="stat-icon yellow">
                  <i className="fa-solid fa-eye" />
                </div>
                <div className="stat-body">
                  <div className="stat-value">{loaded ? stats.visible : "-"}</div>
                  <div className="stat-label">Visible</div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">
                  <i className="fa-solid fa-clock-rotate-left" />
                  Recent Environments
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => handleNav("environments")}>
                  View All &nbsp;<i className="fa-solid fa-arrow-right" />
                </button>
              </div>
              <div id="recentEnvsBody">
                {recentEnvs.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <i className="fa-regular fa-folder-open" />
                    </div>
                    <h3>No environments yet</h3>
                    <p>No Wrike environments have been assigned to you.</p>
                  </div>
                ) : (
                  <table className="dt">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Env ID</th>
                        <th>Created</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentEnvs.map((env) => (
                        <tr key={env.id}>
                          <td>
                            <strong>{env.environment_name}</strong>
                          </td>
                          <td>
                            <div className="action-cell">
                              <code style={{ fontSize: 11, color: "var(--text-muted)" }}>{env.id}</code>
                              <button
                                className={`icon-btn copy-id-btn${copiedId === env.id ? " copied" : ""}`}
                                title="Copy ID"
                                style={{ marginLeft: 4 }}
                                onClick={() => handleCopyRecent(env.id)}
                              >
                                <i className={`fa-solid ${copiedId === env.id ? "fa-check" : "fa-copy"}`} />
                              </button>
                            </div>
                          </td>
                          <td>{formatLocalDate(env.created_at)}</td>
                          <td>
                            <StatusBadge active={env.is_active} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* ══════ ENVIRONMENTS PAGE ══════ */}
          <div className={`page${activePage === "environments" ? " active" : ""}`} id="page-environments">
            <div className="section-header">
              <div>
                <div className="section-title">Environments</div>
                <div className="section-subtitle">Your assigned Wrike environments</div>
              </div>
            </div>

            <div className="card">
              <div className="card-body">
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="table-wrapper" ref={envTableContainerRef} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
