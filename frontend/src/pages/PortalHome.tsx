import { useEffect, useMemo, useRef, useState } from "react";
import {
  canPortal,
  clearPortalSession,
  createPortalEnvironment,
  deletePortalEnvironment,
  getMyPortalPermissions,
  getPortalRole,
  getPortalToken,
  listPortalEnvironmentsFull,
  updatePortalEnvironment,
  type PortalEnvironmentFull,
  type PortalEnvironmentInput,
  type PortalPermissionMatrix,
} from "../lib/portalAuthApi";
import { fetchAppConfig, DEFAULT_CONFIG, type AppConfig } from "../lib/appConfig";
import { useHashPage } from "../lib/useHashPage";
import EnvBadge from "../components/EnvBadge";
import BuildTag from "../components/BuildTag";
import PortalActivityPage from "./PortalActivityPage";
import PortalCachePage from "./PortalCachePage";
import { PortalEnvironmentsTable } from "./PortalEnvironmentsTable";
import "./PortalHome.css";

type PageId = "overview" | "environments" | "activity" | "cache";

const PAGE_NAMES: Record<PageId, string> = {
  overview: "Overview",
  environments: "My Environments",
  activity: "Activity Logs",
  cache: "Cache Settings",
};

const PAGE_IDS = Object.keys(PAGE_NAMES) as PageId[];

/* ── Small shared helpers (ported 1:1 from the EJS <script>) ───────────── */

function decodeJwtPayload(
  token: string,
): { username?: string; email?: string; role?: string } | null {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

function formatLocalDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return "——";
  }
}

function escHtml(str: string | null | undefined): string {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

/** Mask helper — shows first 6 chars + bullets, ported 1:1 from the EJS `mask()`. */
function maskHtml(str: string | null | undefined): string {
  if (!str) return '<span class="mval">—</span>';
  const visible = escHtml(str.substring(0, Math.min(6, str.length)));
  return `<span class="mval">${visible}••••••</span>`;
}

function toast(msg: string, type: "success" | "error" | "info" | "warning") {
  const palettes: Record<string, string> = {
    success: "linear-gradient(135deg,#008262,#006d52)",
    error: "linear-gradient(135deg,#f85149,#d03030)",
    info: "linear-gradient(135deg,#008262,#005c46)",
    warning: "linear-gradient(135deg,#d29922,#b07d12)",
  };
  const icons: Record<string, string> = {
    success: "fa-circle-check",
    error: "fa-circle-xmark",
    info: "fa-circle-info",
    warning: "fa-triangle-exclamation",
  };
  const Toastify = window.Toastify;
  if (!Toastify) return;
  const iconCls = icons[type] || "fa-circle-info";
  const toastBody =
    '<div style="display:flex;align-items:center;gap:10px">' +
    '<i class="fa-solid ' +
    iconCls +
    '" style="flex:none;color:#fff;font-size:15px"></i>' +
    '<span style="flex:1">' +
    escHtml(msg) +
    "</span>" +
    "</div>";
  const toastInstance = Toastify({
    text: "",
    duration: 4500,
    gravity: "top",
    position: "right",
    stopOnFocus: true,
    style: {
      background: palettes[type] || palettes.info,
      borderRadius: "8px",
      fontFamily: "'Inter',sans-serif",
      fontSize: "13.5px",
      padding: "12px 18px",
      boxShadow: "0 6px 24px rgba(0,0,0,0.28)",
      minWidth: "260px",
    },
  }).showToast();
  // This Toastify build does not honour escapeHTML:false, so the icon/message
  // markup is injected straight into the toast node after showToast().
  if (toastInstance?.toastElement) {
    toastInstance.toastElement.innerHTML = toastBody;
  }
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

const EMPTY_FORM = {
  name: "",
  clientId: "",
  clientSecret: "",
  accountId: "",
  xpiApiModules: "",
  xpiApiServices: "",
  xpiEntity: "",
  xpiFieldMapping: "",
  xpiReqFormField: "",
  xpiReqFormMapping: "",
  xpiSpaceName: "",
  campaignSpace: "",
  active: true,
  visible: true,
};

type EnvForm = typeof EMPTY_FORM;

function formFromEnv(env: PortalEnvironmentFull): EnvForm {
  return {
    name: env.environment_name || "",
    clientId: env.client_id || "",
    clientSecret: env.client_secret || "",
    accountId: env.account_id || "",
    xpiApiModules: env.xpi_api_modules_datahub_id || "",
    xpiApiServices: env.xpi_api_services_datahub_id || "",
    xpiEntity: env.xpi_entity_datahub_id || "",
    xpiFieldMapping: env.xpi_field_mapping_datahub_id || "",
    xpiReqFormField: env.xpi_request_form_field_mapping_datahub_id || "",
    xpiReqFormMapping: env.xpi_request_form_mapping_datahub_id || "",
    xpiSpaceName: env.xpi_space_name_datahub_id || "",
    campaignSpace: env.campaign_space_id || "",
    active: !!env.is_active,
    visible: !!env.is_visible,
  };
}

// Faithful React port of views/portal/user.ejs (served at GET /portal/home).
export default function PortalHome() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activePage, setActivePage] = useHashPage<PageId>(PAGE_IDS, "overview");
  const [environments, setEnvironments] = useState<PortalEnvironmentFull[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Bumped by the top-bar Refresh button; the data pages watch it so their
  // own reload matches the shell's, exactly as the admin console's Activity
  // Log does with `refreshKey`.
  const [dataRefreshKey, setDataRefreshKey] = useState(0);

  const token = getPortalToken();
  const role = getPortalRole();
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const { appUrl, wrikeRedirectUrl } = config;

  useEffect(() => {
    fetchAppConfig().then(setConfig);
  }, []);

  /* ── Permission matrix — drives which nav items, pages and CRUD buttons
     render at all. Server-side enforcement (requirePortalPermission) is
     what actually blocks a denied request; this is what keeps a user from
     ever being shown a control that would 403. ─────────────────────────── */
  const [permissions, setPermissions] = useState<PortalPermissionMatrix | null>(null);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);

  useEffect(() => {
    if (!token) return;
    getMyPortalPermissions(token)
      .then((res) => setPermissions(res.permissions))
      .catch((err) => {
        console.error(err);
        setPermissions({});
      })
      .finally(() => setPermissionsLoaded(true));
  }, [token]);

  const can = (moduleKey: string, action: "read" | "create" | "update" | "delete") =>
    canPortal(permissions, moduleKey, action);

  const canSeeEnvironments = can("environments", "read");
  const canSeeActivity = can("activity_logs", "read");
  const canSeeCache = can("cache", "read");
  const canSeeEnvironmentAccess = can("environment_access", "read");

  /* ── Session guard (mirrors the EJS inline script exactly) ──────────── */
  useEffect(() => {
    if (!token) {
      window.location.replace("/portal/login");
    } else if (role === "admin") {
      window.location.replace("/portal/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Sidebar user info ─────────────────────────────────────────────── */
  const jwtPayload = useMemo(() => (token ? decodeJwtPayload(token) : null), [token]);
  const username = jwtPayload?.username || jwtPayload?.email || "User";
  const roleLabel = jwtPayload?.role === "admin" ? "Portal Admin" : "Portal User";

  /* ── Data loading ───────────────────────────────────────────────────── */
  const loadEnvironments = async () => {
    if (!token || !canSeeEnvironments) return;
    window.NProgress?.start();
    try {
      const data = await listPortalEnvironmentsFull(token);
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
    if (!permissionsLoaded) return;
    window.NProgress?.configure({ showSpinner: false, minimum: 0.15 });
    if (canSeeEnvironments) {
      loadEnvironments();
    } else {
      setLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, permissionsLoaded, canSeeEnvironments]);

  // If the current page requires a permission the matrix doesn't grant
  // (a stale #hash, or an admin revoked access mid-session), bounce to
  // Overview rather than rendering a page with no data and no actions.
  useEffect(() => {
    if (!permissionsLoaded) return;
    if (activePage === "environments" && !canSeeEnvironments) setActivePage("overview");
    if (activePage === "activity" && !canSeeActivity) setActivePage("overview");
    if (activePage === "cache" && !canSeeCache) setActivePage("overview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionsLoaded, activePage, canSeeEnvironments, canSeeActivity, canSeeCache]);

  const stats = useMemo(() => {
    const total = environments.length;
    const active = environments.filter((e) => e.is_active).length;
    const visible = environments.filter((e) => e.is_visible).length;
    return { total, active, inactive: total - active, visible };
  }, [environments]);

  const recentEnvs = environments.slice(0, 5);

  /* ── Add/Edit Environment modal ────────────────────────────────────── */
  const [envModalOpen, setEnvModalOpen] = useState(false);
  const [envEditId, setEnvEditId] = useState<string | null>(null);
  const [form, setForm] = useState<EnvForm>(EMPTY_FORM);
  const [secretVisible, setSecretVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const setField = <K extends keyof EnvForm>(key: K, value: EnvForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function openEnvModal(env: PortalEnvironmentFull | null) {
    setEnvEditId(env ? env.id : null);
    setSecretVisible(false);
    setForm(env ? formFromEnv(env) : EMPTY_FORM);
    setEnvModalOpen(true);
    setTimeout(() => nameInputRef.current?.focus(), 80);
  }

  function closeEnvModal() {
    setEnvModalOpen(false);
    setEnvEditId(null);
  }

  const editingEnv = envEditId ? environments.find((e) => e.id === envEditId) || null : null;
  const showRedirectSection = !!(envEditId && wrikeRedirectUrl && appUrl && editingEnv?.id);

  /* ── Save environment (validation order matches the EJS handler) ────── */
  const handleSave = async () => {
    if (!token) return;
    const name = form.name.trim();
    const clientId = form.clientId.trim();
    const clientSecret = form.clientSecret.trim();
    const accountId = form.accountId.trim();
    const xpiApiModules = form.xpiApiModules.trim();
    const xpiApiServices = form.xpiApiServices.trim();
    const xpiEntity = form.xpiEntity.trim();
    const xpiFieldMapping = form.xpiFieldMapping.trim();
    const xpiReqFormField = form.xpiReqFormField.trim();
    const xpiReqFormMapping = form.xpiReqFormMapping.trim();
    const xpiSpaceName = form.xpiSpaceName.trim();
    const campaignSpace = form.campaignSpace.trim();

    if (!name) return toast("Environment name is required", "warning");
    if (!clientId) return toast("Client ID is required", "warning");
    if (!clientSecret) return toast("Client Secret is required", "warning");
    if (!xpiApiModules) return toast("XPI API Modules Datahub ID is required", "warning");
    if (!xpiApiServices) return toast("XPI API Services Datahub ID is required", "warning");
    if (!xpiEntity) return toast("XPI Entity Datahub ID is required", "warning");
    if (!xpiFieldMapping) return toast("XPI Field Mapping Datahub ID is required", "warning");
    if (!xpiReqFormField)
      return toast("XPI Request Form Field Mapping Datahub ID is required", "warning");
    if (!xpiReqFormMapping)
      return toast("XPI Request Form Mapping Datahub ID is required", "warning");
    if (!xpiSpaceName) return toast("XPI Space Name Datahub ID is required", "warning");
    if (!campaignSpace) return toast("Campaign Space ID is required", "warning");

    setSaving(true);
    try {
      const input: PortalEnvironmentInput = {
        environment_name: name,
        client_id: clientId,
        client_secret: clientSecret,
        account_id: accountId || null,
        xpi_api_modules_datahub_id: xpiApiModules,
        xpi_api_services_datahub_id: xpiApiServices,
        xpi_entity_datahub_id: xpiEntity,
        xpi_field_mapping_datahub_id: xpiFieldMapping,
        xpi_request_form_field_mapping_datahub_id: xpiReqFormField,
        xpi_request_form_mapping_datahub_id: xpiReqFormMapping,
        xpi_space_name_datahub_id: xpiSpaceName,
        campaign_space_id: campaignSpace,
        is_active: form.active,
        is_visible: form.visible,
      };

      const isEdit = !!envEditId;
      const saved = isEdit
        ? await updatePortalEnvironment(token, envEditId as string, input)
        : await createPortalEnvironment(token, input);

      closeEnvModal();

      if (!isEdit && wrikeRedirectUrl && appUrl && saved?.id) {
        const redirectUrl = wrikeRedirectUrl;
        const loginUrl = appUrl + "?environmentId=" + saved.id;
        setTimeout(() => showRedirectUrlModal(redirectUrl, loginUrl), 300);
      } else {
        toast(isEdit ? "Environment updated" : "Environment created", "success");
      }

      await loadEnvironments();
    } catch (err) {
      toast((err as Error).message || "Failed to save environment", "error");
    } finally {
      setSaving(false);
    }
  };

  /* ── Delete environment ─────────────────────────────────────────────── */
  const handleDeleteEnvironment = async (id: string, name: string) => {
    if (!token) return;
    const Swal = window.Swal;
    const result = Swal
      ? await Swal.fire({
          title: "Delete environment?",
          html: `This will permanently delete <strong>${escHtml(name)}</strong>. This cannot be undone.`,
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
      await deletePortalEnvironment(token, id);
      toast("Environment deleted", "success");
      await loadEnvironments();
    } catch (err) {
      toast((err as Error).message || "Failed to delete environment", "error");
    }
  };

  /* ── Redirect URL success modal ────────────────────────────────────── */
  const [redirectModalOpen, setRedirectModalOpen] = useState(false);
  const [successRedirectUrl, setSuccessRedirectUrl] = useState("");
  const [successLoginUrl, setSuccessLoginUrl] = useState("");
  const [countdown, setCountdown] = useState(8);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function showRedirectUrlModal(redirectUrl: string, loginUrl: string) {
    setSuccessRedirectUrl(redirectUrl);
    setSuccessLoginUrl(loginUrl);
    setRedirectModalOpen(true);
    setCountdown(8);

    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
          setRedirectModalOpen(false);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  function closeRedirectUrlModal() {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setRedirectModalOpen(false);
  }

  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, []);

  /* ── Copy-to-clipboard icon feedback (redirect/login URL boxes) ─────── */
  const [copiedIcon, setCopiedIcon] = useState<string | null>(null);
  const copyWithFeedback = (text: string, iconKey: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIcon(iconKey);
      setTimeout(() => setCopiedIcon((cur) => (cur === iconKey ? null : cur)), 1500);
    });
  };

  /* ── Actions ────────────────────────────────────────────────────────── */
  const handleNav = (page: PageId) => {
    setActivePage(page);
    setMobileOpen(false);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    setDataRefreshKey((k) => k + 1);
    loadEnvironments().finally(() => {
      setTimeout(() => setRefreshing(false), 600);
    });
  };

  const handleLogout = async () => {
    const Swal = window.Swal;
    const result = Swal
      ? await Swal.fire({
          title: "Sign out?",
          html: "Your portal session will be ended.",
          icon: "question",
          showCancelButton: true,
          confirmButtonText:
            '<i class="fa-solid fa-right-from-bracket" style="margin-right:6px"></i>Sign Out',
          cancelButtonText: "Stay",
          reverseButtons: true,
        })
      : { isConfirmed: true };

    if (!result.isConfirmed) return;

    clearPortalSession();
    window.location.replace("/portal/login");
  };

  const pageTitle = PAGE_NAMES[activePage];

  if (!token || role === "admin") return null;

  return (
    <div id="app">
      {/* ═══════════ SIDEBAR ═══════════ */}
      <nav id="sidebar" className={`${collapsed ? "collapsed " : ""}${mobileOpen ? "mobile-open" : ""}`.trim()}>
        <div className="sidebar-logo-row">
          <a className="sidebar-logo" href="/portal/home">
            <div className="logo-mark">
              <svg viewBox="0 0 31 20" role="img" aria-label="Wrike symbol" aria-hidden="true">
                <path d="M20.78 1.404C21.885.298 22.587 0 24.113 0h6.878c.561 0 .684.509.35.842l-11.49 11.491c-.176.176-.246.21-.352.246-.035.018-.087.018-.122.018s-.088 0-.123-.018c-.106-.035-.176-.07-.351-.246L14.85 8.281c-.175-.176-.21-.246-.245-.351-.018-.035-.018-.088-.018-.123s0-.088.018-.123c.035-.105.07-.175.245-.35l5.93-5.93zM10.745 8.649C9.64 7.544 8.92 7.263 7.395 7.263H.534c-.562 0-.685.509-.351.842l11.49 11.492c.176.175.246.21.352.245a.299.299 0 00.123.018c.035 0 .087 0 .122-.018.105-.035.176-.07.351-.245l4.053-4.07c.175-.176.21-.246.245-.351a.3.3 0 00.018-.123c0-.035 0-.088-.018-.123-.035-.105-.07-.175-.245-.351l-5.93-5.93z" />
              </svg>
            </div>
            <div className="logo-text">
              <span className="brand">
                Xtend Backend
                <BuildTag />
              </span>
              <span
                className="sub"
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                User Portal
                {!collapsed && <EnvBadge />}
              </span>
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
          {canSeeEnvironments && (
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
          )}

          {(canSeeCache || canSeeActivity) && (
            <div className="nav-group-label" style={{ marginTop: 6 }}>
              Settings
            </div>
          )}
          {canSeeCache && (
            <div
              className={`nav-item${activePage === "cache" ? " active" : ""}`}
              onClick={() => handleNav("cache")}
            >
              <span className="ni">
                <i className="fa-solid fa-database" />
              </span>
              <span className="nl">Cache Settings</span>
            </div>
          )}
          {canSeeActivity && (
            <div
              className={`nav-item${activePage === "activity" ? " active" : ""}`}
              onClick={() => handleNav("activity")}
            >
              <span className="ni">
                <i className="fa-solid fa-clock-rotate-left" />
              </span>
              <span className="nl">Activity Log</span>
            </div>
          )}
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
                <div className="section-subtitle">Welcome back, {username}</div>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card blue">
                <div className="stat-icon blue">
                  <i className="fa-solid fa-layer-group" />
                </div>
                <div className="stat-body">
                  <div className="stat-value">{loaded ? stats.total : "—"}</div>
                  <div className="stat-label">Total Environments</div>
                </div>
              </div>
              <div className="stat-card green">
                <div className="stat-icon green">
                  <i className="fa-solid fa-circle-check" />
                </div>
                <div className="stat-body">
                  <div className="stat-value">{loaded ? stats.active : "—"}</div>
                  <div className="stat-label">Active</div>
                </div>
              </div>
              <div className="stat-card red">
                <div className="stat-icon red">
                  <i className="fa-solid fa-circle-xmark" />
                </div>
                <div className="stat-body">
                  <div className="stat-value">{loaded ? stats.inactive : "—"}</div>
                  <div className="stat-label">Inactive</div>
                </div>
              </div>
              <div className="stat-card yellow">
                <div className="stat-icon yellow">
                  <i className="fa-solid fa-eye" />
                </div>
                <div className="stat-body">
                  <div className="stat-value">{loaded ? stats.visible : "—"}</div>
                  <div className="stat-label">Visible</div>
                </div>
              </div>
            </div>

            {canSeeEnvironments && (
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
                    <p>Add your first Wrike environment to get started.</p>
                  </div>
                ) : (
                  <table className="dt">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Env ID</th>
                        <th>Client ID</th>
                        <th>Created</th>
                        <th>Status</th>
                        <th></th>
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
                                className="icon-btn copy-id-btn"
                                title="Copy ID"
                                style={{ marginLeft: 4 }}
                              >
                                <i className="fa-solid fa-copy" />
                              </button>
                            </div>
                          </td>
                          <td dangerouslySetInnerHTML={{ __html: maskHtml(env.client_id) }} />
                          <td>{formatLocalDate(env.created_at)}</td>
                          <td>
                            <StatusBadge active={env.is_active} />
                          </td>
                          <td>
                            {can("environments", "update") && (
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => openEnvModal(env)}
                              >
                                <i className="fa-solid fa-pen-to-square" /> Edit
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
            )}
          </div>

          {/* ══════ ENVIRONMENTS PAGE ══════ */}
          {canSeeEnvironments && (
          <div className={`page${activePage === "environments" ? " active" : ""}`} id="page-environments">
            <div className="section-header">
              <div>
                <div className="section-title">My Environments</div>
                <div className="section-subtitle">Manage your Wrike environments</div>
              </div>
              {can("environments", "create") && (
                <button className="btn btn-primary" onClick={() => openEnvModal(null)}>
                  <i className="fa-solid fa-plus" />
                  Add Environment
                </button>
              )}
            </div>

            <div className="card">
              <div className="card-body">
                <PortalEnvironmentsTable
                  environments={environments}
                  loading={!loaded}
                  canUpdate={can("environments", "update")}
                  canDelete={can("environments", "delete")}
                  onEdit={openEnvModal}
                  onDelete={(env) => handleDeleteEnvironment(env.id, env.environment_name)}
                  onAdd={() => openEnvModal(null)}
                />
              </div>
            </div>
          </div>
          )}

          {/* ══════ ACTIVITY LOGS PAGE ══════ */}
          {canSeeActivity && (
          <div className={`page${activePage === "activity" ? " active" : ""}`} id="page-activity">
            <PortalActivityPage
              active={activePage === "activity"}
              environments={environments}
              refreshKey={dataRefreshKey}
            />
          </div>
          )}

          {/* ══════ CACHE SETTINGS PAGE ══════ */}
          {canSeeCache && (
          <div className={`page${activePage === "cache" ? " active" : ""}`} id="page-cache">
            <PortalCachePage active={activePage === "cache"} canDelete={can("cache", "delete")} />
          </div>
          )}
        </div>
      </div>

      {/* ════════════ REDIRECT URL SUCCESS MODAL ════════════ */}
      <div className={`modal-backdrop${redirectModalOpen ? " open" : ""}`}>
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="redirectModalTitle"
          style={{ maxWidth: 480 }}
        >
          <div className="modal-header">
            <div className="modal-title">
              <i className="fa-solid fa-link" style={{ color: "var(--success)" }} />
              <span id="redirectModalTitle">Environment Created Successfully</span>
            </div>
            <button className="modal-close" aria-label="Close" onClick={closeRedirectUrlModal}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>

          <div className="modal-body">
            <div style={{ marginBottom: 16 }}>
              <p style={{ color: "var(--text-secondary)", marginBottom: 8, fontSize: 13 }}>
                Redirect URL (for Wrike OAuth):
              </p>
              <div className="redirect-url-box" style={{ position: "relative" }}>
                <div className="redirect-url-text" style={{ marginRight: 36 }}>
                  {successRedirectUrl}
                </div>
                <i
                  className={`fa-solid ${copiedIcon === "successUrl" ? "fa-check" : "fa-copy"}`}
                  title="Copy URL"
                  onClick={() => copyWithFeedback(successRedirectUrl, "successUrl")}
                />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <p style={{ color: "var(--text-secondary)", marginBottom: 8, fontSize: 13 }}>
                Login URL (with environment):
              </p>
              <div className="redirect-url-box" style={{ position: "relative" }}>
                <div className="redirect-url-text" style={{ marginRight: 36 }}>
                  {successLoginUrl}
                </div>
                <i
                  className={`fa-solid ${copiedIcon === "successLoginUrl" ? "fa-check" : "fa-copy"}`}
                  title="Copy URL"
                  onClick={() => copyWithFeedback(successLoginUrl, "successLoginUrl")}
                />
              </div>
            </div>
          </div>

          <div className="modal-footer" style={{ justifyContent: "space-between" }}>
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
              Close in <strong>{countdown}</strong>s
            </div>
            <button className="btn btn-primary" onClick={closeRedirectUrlModal}>
              <i className="fa-solid fa-check" /> Done
            </button>
          </div>
        </div>
      </div>

      {/* ════════════ ADD / EDIT ENVIRONMENT MODAL ════════════ */}
      <div
        className={`modal-backdrop${envModalOpen ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeEnvModal();
        }}
      >
        <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">
              <i className={`fa-solid ${envEditId ? "fa-pen-to-square" : "fa-layer-group"}`} />
              <span>{envEditId ? "Edit Environment" : "Add Environment"}</span>
            </div>
            <button className="modal-close" onClick={closeEnvModal}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label" htmlFor="envModalName">
                Environment Name <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                ref={nameInputRef}
                type="text"
                className="form-control"
                id="envModalName"
                placeholder="e.g. Production, Staging, Development"
                maxLength={255}
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
              />
            </div>

            <div className="form-section-label">Credentials</div>

            <div className="form-group">
              <label className="form-label" htmlFor="envModalClientId">
                Client ID <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                type="text"
                className="form-control"
                id="envModalClientId"
                placeholder="Enter Client ID"
                autoComplete="off"
                value={form.clientId}
                onChange={(e) => setField("clientId", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="envModalClientSecret">
                Client Secret <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={secretVisible ? "text" : "password"}
                  className="form-control"
                  id="envModalClientSecret"
                  placeholder="Enter Client Secret"
                  autoComplete="new-password"
                  style={{ paddingRight: 38 }}
                  value={form.clientSecret}
                  onChange={(e) => setField("clientSecret", e.target.value)}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    fontSize: 14,
                    padding: 0,
                    lineHeight: 1,
                  }}
                  onClick={() => setSecretVisible((v) => !v)}
                >
                  <i className={`fa-solid ${secretVisible ? "fa-eye-slash" : "fa-eye"}`} />
                </button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="envModalAccountId">
                Account ID
              </label>
              <input
                type="text"
                className="form-control"
                id="envModalAccountId"
                placeholder="Enter Wrike Account ID"
                maxLength={255}
                value={form.accountId}
                onChange={(e) => setField("accountId", e.target.value)}
              />
            </div>

            <div className="form-section-label">Datahub IDs</div>

            <div className="form-group">
              <label className="form-label" htmlFor="envModalXpiApiModules">
                XPI API Modules Datahub ID <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                type="text"
                className="form-control"
                id="envModalXpiApiModules"
                placeholder="Enter XPI API Modules Datahub ID"
                value={form.xpiApiModules}
                onChange={(e) => setField("xpiApiModules", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="envModalXpiApiServices">
                XPI API Services Datahub ID <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                type="text"
                className="form-control"
                id="envModalXpiApiServices"
                placeholder="Enter XPI API Services Datahub ID"
                value={form.xpiApiServices}
                onChange={(e) => setField("xpiApiServices", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="envModalXpiEntity">
                XPI Entity Datahub ID <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                type="text"
                className="form-control"
                id="envModalXpiEntity"
                placeholder="Enter XPI Entity Datahub ID"
                value={form.xpiEntity}
                onChange={(e) => setField("xpiEntity", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="envModalXpiFieldMapping">
                XPI Field Mapping Datahub ID <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                type="text"
                className="form-control"
                id="envModalXpiFieldMapping"
                placeholder="Enter XPI Field Mapping Datahub ID"
                value={form.xpiFieldMapping}
                onChange={(e) => setField("xpiFieldMapping", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="envModalXpiReqFormField">
                XPI Request Form Field Mapping Datahub ID <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                type="text"
                className="form-control"
                id="envModalXpiReqFormField"
                placeholder="Enter XPI Request Form Field Mapping Datahub ID"
                value={form.xpiReqFormField}
                onChange={(e) => setField("xpiReqFormField", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="envModalXpiReqFormMapping">
                XPI Request Form Mapping Datahub ID <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                type="text"
                className="form-control"
                id="envModalXpiReqFormMapping"
                placeholder="Enter XPI Request Form Mapping Datahub ID"
                value={form.xpiReqFormMapping}
                onChange={(e) => setField("xpiReqFormMapping", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="envModalXpiSpaceName">
                XPI Space Name Datahub ID <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                type="text"
                className="form-control"
                id="envModalXpiSpaceName"
                placeholder="Enter XPI Space Name Datahub ID"
                value={form.xpiSpaceName}
                onChange={(e) => setField("xpiSpaceName", e.target.value)}
              />
            </div>

            <div className="form-section-label">Space IDs</div>

            <div className="form-group">
              <label className="form-label" htmlFor="envModalCampaignSpace">
                Campaign Space ID <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                type="text"
                className="form-control"
                id="envModalCampaignSpace"
                placeholder="Enter Campaign Space ID"
                value={form.campaignSpace}
                onChange={(e) => setField("campaignSpace", e.target.value)}
              />
            </div>

            <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "8px 0 14px" }} />
            <div className="toggle-row">
              <div className="toggle-row-info">
                <div className="toggle-row-label">Active Status</div>
                <div className="toggle-row-desc">Enable or disable this environment</div>
              </div>
              <label className="toggle-wrap">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setField("active", e.target.checked)}
                />
                <span className="toggle-track"></span>
              </label>
            </div>
            <div className="toggle-row">
              <div className="toggle-row-info">
                <div className="toggle-row-label">Visibility</div>
                <div className="toggle-row-desc">Show or hide in environment dropdowns</div>
              </div>
              <label className="toggle-wrap">
                <input
                  type="checkbox"
                  checked={form.visible}
                  onChange={(e) => setField("visible", e.target.checked)}
                />
                <span className="toggle-track"></span>
              </label>
            </div>

            {envEditId && (
              <div id="envRedirectUrlContainer">
                <div className="form-section-label">URLs</div>
                <div>
                  <p style={{ color: "var(--text-secondary)", marginBottom: 6, fontSize: 12 }}>
                    Redirect URL:
                  </p>
                  {showRedirectSection ? (
                    <div className="redirect-url-box">
                      <div className="redirect-url-text">{wrikeRedirectUrl}</div>
                      <i
                        className={`fa-solid ${copiedIcon === "envRedirect" ? "fa-check" : "fa-copy"}`}
                        onClick={() => copyWithFeedback(wrikeRedirectUrl, "envRedirect")}
                      />
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: 12,
                        background: "var(--bg-surface)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--text-muted)",
                        fontSize: 13,
                      }}
                    >
                      <em>Save the environment first to generate the redirect and login URLs.</em>
                    </div>
                  )}
                </div>
                {showRedirectSection && (
                  <div style={{ marginTop: 12 }}>
                    <p style={{ color: "var(--text-secondary)", marginBottom: 6, fontSize: 12 }}>
                      Login URL:
                    </p>
                    <div className="redirect-url-box">
                      <div className="redirect-url-text">
                        {appUrl + "?environmentId=" + (editingEnv?.id || "")}
                      </div>
                      <i
                        className={`fa-solid ${copiedIcon === "envLogin" ? "fa-check" : "fa-copy"}`}
                        onClick={() =>
                          copyWithFeedback(appUrl + "?environmentId=" + (editingEnv?.id || ""), "envLogin")
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={closeEnvModal}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin" /> Saving…
                </>
              ) : (
                <>
                  <i className="fa-solid fa-floppy-disk" /> Save
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
