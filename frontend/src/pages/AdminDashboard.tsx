import { useEffect, useRef, useState } from "react";
import { adminLogout, clearAdminSession, getAccessToken } from "../lib/authApi";
import { fetchAppConfig, type AppConfig } from "../lib/appConfig";
import { useHashPage } from "../lib/useHashPage";
import {
  assignPortalUserEnvironment,
  bulkDeleteCacheEntries,
  createEnvironment,
  createPortalUser,
  deleteCacheEntry,
  deleteEnvironment,
  generatePortalUserCredentials,
  getCacheDetail,
  getPortalUserEnvironments,
  listCacheEntries,
  listEnvironments,
  listPortalUsers,
  resetPortalUserPassword,
  revokePortalUserEnvironment,
  toggleEnvironmentStatus,
  togglePortalUserStatus,
  updateEnvironment,
  updatePortalUser,
  type AdminEnvironment,
  type CacheEntry,
  type PortalUser,
} from "../lib/adminApi";
import EnvironmentAccess from "./EnvironmentAccess";
import PortalUserPermissions from "./PortalUserPermissions";
import ActivityLog from "./ActivityLog";
import "./AdminDashboard.css";

type PageId =
  | "overview"
  | "environments"
  | "users"
  | "settings"
  | "cache-settings"
  | "activity-log";

const PAGE_NAMES: Record<PageId, string> = {
  overview: "Overview",
  environments: "Environments",
  users: "Users",
  settings: "Settings",
  "cache-settings": "Cache Settings",
  "activity-log": "Activity Log",
};

const PAGE_IDS = Object.keys(PAGE_NAMES) as PageId[];

const CACHE_SEARCH_DEBOUNCE_MS = 350;

/* ── Small shared helpers (ported 1:1 from the EJS <script>) ───────────── */

function escHtml(str: string | null | undefined): string {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function formatLocalDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
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

function puFmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function mask(str: string | null | undefined): string {
  if (!str) return '<span class="mval">—</span>';
  const visible = escHtml(str.substring(0, Math.min(6, str.length)));
  return '<span class="mval">' + visible + "••••••</span>";
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
      fontFamily: "'Inter', sans-serif",
      fontSize: "13.5px",
      padding: "12px 18px",
      boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
      minWidth: "260px",
    },
  }).showToast();
  // This Toastify build does not honour escapeHTML:false, so the icon/message
  // markup is injected straight into the toast node after showToast().
  if (toastInstance?.toastElement) {
    toastInstance.toastElement.innerHTML = toastBody;
  }
}

function badgeHtml(active: boolean): string {
  return active
    ? '<span class="badge badge-success"><span class="dot"></span> Active</span>'
    : '<span class="badge badge-danger"><span class="dot"></span> Inactive</span>';
}

/* ── Row ⋯ menu (vertical-dots “Actions” dropdown) ────────────────────────
   Both the Environments and the Portal Users tables collapse their per-row
   actions into ONE vertical-dots trigger. Clicking it opens a small floating
   menu appended to <body> (so the DataTables overflow/scrolled containers
   can never clip it); choosing an item closes the menu and runs the action.
   Esc, an outside click, resize or page switch closes it too. */
interface RowMenuItem {
  label: string;
  icon: string; // FontAwesome classes, e.g. "fa-solid fa-pen-to-square"
  danger?: boolean;
  onClick: () => void;
}

let rowMenuActive: { el: HTMLElement; close: () => void } | null = null;

function closeRowMenu() {
  if (!rowMenuActive) return;
  rowMenuActive.close();
  rowMenuActive = null;
}

function openRowMenu(anchor: HTMLElement, items: RowMenuItem[]) {
  closeRowMenu();

  const menu = document.createElement("div");
  menu.className = "row-menu";
  menu.setAttribute("role", "menu");

  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "row-menu-item" + (item.danger ? " danger" : "");
    btn.setAttribute("role", "menuitem");
    btn.innerHTML =
      '<i class="' + item.icon + '"></i><span>' + item.label + "</span>";
    btn.addEventListener("click", () => {
      closeRowMenu();
      item.onClick();
    });
    menu.appendChild(btn);
  });

  const close = () => {
    anchor.classList.remove("row-menu-open");
    menu.remove();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onDocDown, true);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onScroll, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeRowMenu();
  };
  const onResize = () => closeRowMenu();
  const onScroll = () => closeRowMenu();
  const onDocDown = (e: MouseEvent) => {
    const target = e.target as Node;
    // Ignore clicks inside the menu or on its own trigger — the trigger's
    // delegated click toggles the menu, and menu items close then run.
    if (menu.contains(target) || anchor.contains(target)) return;
    closeRowMenu();
  };

  anchor.classList.add("row-menu-open");
  document.body.appendChild(menu);

  // Measure while hidden, then place it against the trigger — flipping
  // upward and clamping to the viewport so it never opens off-screen.
  menu.style.visibility = "hidden";
  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let top = anchorRect.bottom + 6;
  if (top + menuRect.height > window.innerHeight - 8) {
    top = Math.max(8, anchorRect.top - menuRect.height - 6);
  }
  let left = anchorRect.right - menuRect.width;
  left = Math.max(8, Math.min(left, window.innerWidth - menuRect.width - 8));
  menu.style.top = top + "px";
  menu.style.left = left + "px";
  menu.style.visibility = "visible";

  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", onDocDown, true);
  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", onScroll, true);

  rowMenuActive = { el: menu, close };
}

// Raw-HTML toggle for the DataTables-rendered rows (jQuery-owned markup, not
// React) — matches the .toggle-wrap/.toggle-track control used everywhere
// else (edit modal, environment access drawer). A delegated `change` handler
// (see the env table's action-handler effect) reads data-id/data-field back
// off the element that fired.
function envToggleHtml(id: string, field: "is_active" | "is_visible", checked: boolean): string {
  return (
    '<label class="toggle-wrap toggle-wrap-sm">' +
    '<input type="checkbox" class="env-toggle" data-id="' +
    id +
    '" data-field="' +
    field +
    '"' +
    (checked ? " checked" : "") +
    " />" +
    '<div class="toggle-track"></div>' +
    "</label>"
  );
}

// True when the two lists are the SAME rows in the SAME order and every value
// matches except the is_active/is_visible booleans — i.e. a pure toggle
// change that can be applied to the existing table in place.
function envsDifferOnlyByToggles(
  prev: AdminEnvironment[],
  next: AdminEnvironment[],
): boolean {
  if (prev.length !== next.length) return false;
  const toggleKeys = new Set(["is_active", "is_visible"]);
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i] as unknown as Record<string, unknown>;
    const n = next[i] as unknown as Record<string, unknown>;
    const pKeys = Object.keys(p);
    if (pKeys.length !== Object.keys(n).length) return false;
    for (const key of pKeys) {
      if (toggleKeys.has(key)) continue;
      if (!(key in n) || !Object.is(p[key], n[key])) return false;
    }
  }
  return true;
}

function puStatusBadge(active: boolean): string {
  return active
    ? '<span class="badge badge-success"><span class="dot"></span> Active</span>'
    : '<span class="badge badge-danger"><span class="dot"></span> Inactive</span>';
}

function puRoleBadge(role: string): string {
  return role === "admin"
    ? '<span class="badge badge-info"><i class="fa-solid fa-shield-halved"></i> Admin</span>'
    : '<span class="badge" style="background:var(--bg-surface);color:var(--text-muted);border:1px solid var(--border);"><i class="fa-solid fa-user"></i> User</span>';
}

/* ── Environment form shape (mirrors the #envForm fields) ──────────────── */

interface EnvFormState {
  environment_name: string;
  client_id: string;
  client_secret: string;
  account_id: string;
  xpi_api_modules_datahub_id: string;
  xpi_api_services_datahub_id: string;
  xpi_entity_datahub_id: string;
  xpi_field_mapping_datahub_id: string;
  xpi_request_form_field_mapping_datahub_id: string;
  xpi_request_form_mapping_datahub_id: string;
  xpi_space_name_datahub_id: string;
  campaign_space_id: string;
  is_visible: boolean;
  is_active: boolean;
}

const EMPTY_ENV_FORM: EnvFormState = {
  environment_name: "",
  client_id: "",
  client_secret: "",
  account_id: "",
  xpi_api_modules_datahub_id: "",
  xpi_api_services_datahub_id: "",
  xpi_entity_datahub_id: "",
  xpi_field_mapping_datahub_id: "",
  xpi_request_form_field_mapping_datahub_id: "",
  xpi_request_form_mapping_datahub_id: "",
  xpi_space_name_datahub_id: "",
  campaign_space_id: "",
  is_visible: true,
  is_active: true,
};

function envToForm(env: AdminEnvironment): EnvFormState {
  return {
    environment_name: env.environment_name,
    client_id: env.client_id,
    client_secret: env.client_secret,
    account_id: env.account_id,
    xpi_api_modules_datahub_id: env.xpi_api_modules_datahub_id,
    xpi_api_services_datahub_id: env.xpi_api_services_datahub_id,
    xpi_entity_datahub_id: env.xpi_entity_datahub_id,
    xpi_field_mapping_datahub_id: env.xpi_field_mapping_datahub_id,
    xpi_request_form_field_mapping_datahub_id: env.xpi_request_form_field_mapping_datahub_id,
    xpi_request_form_mapping_datahub_id: env.xpi_request_form_mapping_datahub_id,
    xpi_space_name_datahub_id: env.xpi_space_name_datahub_id,
    campaign_space_id: env.campaign_space_id,
    is_visible: env.is_visible,
    is_active: env.is_active,
  };
}

function envToDuplicateForm(env: AdminEnvironment): EnvFormState {
  let dupName = env.environment_name + " Copy";
  if (dupName.length > 255) {
    dupName = env.environment_name.substring(0, 245) + " Copy";
  }
  return {
    ...envToForm(env),
    environment_name: dupName,
    client_id: "",
    client_secret: "",
    account_id: "",
  };
}

const ENV_TABLE_HEAD = `
  <thead>
    <tr>
      <th>Environment</th>
      <th>Client ID</th>
      <th>Account ID</th>
      <th>Last Updated</th>
      <th>Visibility</th>
      <th>Status</th>
      <th class="env-actions-col" style="width: 64px">Actions</th>
    </tr>
  </thead>
`;

const PU_TABLE_HEAD = `
  <thead>
    <tr>
      <th>Username</th>
      <th>Full Name</th>
      <th>Email</th>
      <th>Role</th>
      <th>Last Login</th>
      <th>Status</th>
      <th>Must Change Pwd</th>
      <th class="pu-actions-col" style="width: 64px">Actions</th>
    </tr>
  </thead>
`;

const CACHE_TABLE_HEAD = `
  <thead>
    <tr>
      <th style="width: 42px"><input type="checkbox" id="cacheSelectAll" /></th>
      <th>Key</th>
      <th>Type</th>
      <th>TTL</th>
      <th>Size</th>
      <th style="width: 120px">Actions</th>
    </tr>
  </thead>
`;

function envRowHtml(env: AdminEnvironment): string {
  return (
    "<tr>" +
    "<td>" +
    '<div class="env-name-cell">' +
    "<strong>" +
    escHtml(env.environment_name) +
    "</strong>" +
    '<div class="action-cell env-id-row">' +
    '<code style="font-size: 11px; color: var(--text-muted);">' +
    escHtml(env.id) +
    "</code>" +
    '<button class="icon-btn copy-id-btn" data-id="' +
    env.id +
    '" title="Copy ID">' +
    '<i class="fa-solid fa-copy"></i>' +
    "</button>" +
    "</div>" +
    "</div>" +
    "</td>" +
    "<td>" +
    escHtml(env.client_id) +
    "</td>" +
    "<td>" +
    (env.account_id
      ? escHtml(env.account_id)
      : '<span style="color:var(--text-muted)">—</span>') +
    "</td>" +
    "<td>" +
    formatLocalDate(env.updated_at) +
    "</td>" +
    "<td>" +
    envToggleHtml(env.id, "is_visible", env.is_visible) +
    "</td>" +
    "<td>" +
    envToggleHtml(env.id, "is_active", env.is_active) +
    "</td>" +
    '<td class="env-actions-col">' +
    '<button type="button" class="icon-btn row-menu-trigger" data-menu="env" data-id="' +
    env.id +
    '" data-name="' +
    escHtml(env.environment_name) +
    '" title="Actions">' +
    '<i class="fa-solid fa-ellipsis-vertical"></i>' +
    "</button>" +
    "</td>" +
    "</tr>"
  );
}

function puRowHtml(u: PortalUser): string {
  return (
    "<tr>" +
    "<td><strong>" +
    escHtml(u.username) +
    "</strong></td>" +
    "<td>" +
    (u.full_name ? escHtml(u.full_name) : '<span style="color:var(--text-muted)">—</span>') +
    "</td>" +
    '<td style="font-size:12.5px;">' +
    (u.email ? escHtml(u.email) : '<span style="color:var(--text-muted)">—</span>') +
    "</td>" +
    "<td>" +
    puRoleBadge(u.role) +
    "</td>" +
    '<td style="font-size:12px;color:var(--text-muted);">' +
    puFmtDate(u.last_login_at) +
    "</td>" +
    "<td>" +
    puStatusBadge(u.is_active) +
    "</td>" +
    "<td>" +
    (u.must_change_password
      ? '<span class="badge badge-warning"><i class="fa-solid fa-clock"></i> Pending</span>'
      : '<span class="badge badge-success"><i class="fa-solid fa-check"></i> Set</span>') +
    "</td>" +
    '<td class="pu-actions-col">' +
    '<button type="button" class="icon-btn row-menu-trigger" data-menu="pu" data-id="' +
    u.id +
    '" data-username="' +
    escHtml(u.username) +
    '" data-active="' +
    u.is_active +
    '" title="Actions">' +
    '<i class="fa-solid fa-ellipsis-vertical"></i>' +
    "</button>" +
    "</td>" +
    "</tr>"
  );
}

function cacheRowHtml(entry: CacheEntry): string {
  const encodedKey = encodeURIComponent(entry.key);
  const typeBadge =
    '<span class="badge" style="background: var(--bg-surface); color: var(--text-secondary); border: 1px solid var(--border)">' +
    escHtml(entry.redis_type || "unknown") +
    "</span>";

  return (
    "<tr>" +
    `<td><input type="checkbox" class="cache-row-check" data-key="${encodedKey}" /></td>` +
    `<td><span class="cache-key" title="${escHtml(entry.key)}">${escHtml(entry.key)}</span></td>` +
    `<td>${typeBadge}</td>` +
    `<td>${escHtml(entry.ttl_label || "Unavailable")}</td>` +
    `<td>${formatBytes(entry.size_bytes)}</td>` +
    "<td>" +
    '<div class="cache-action-wrap">' +
    `<button class="btn btn-ghost btn-sm cache-view-btn" data-key="${encodedKey}" title="View"><i class="fa-regular fa-eye"></i></button>` +
    `<button class="btn btn-ghost btn-sm cache-delete-btn" data-key="${encodedKey}" title="Delete" style="color: var(--danger)"><i class="fa-regular fa-trash-can"></i></button>` +
    "</div>" +
    "</td>" +
    "</tr>"
  );
}

/** Restructures a freshly-initialized DataTables wrapper so only the table
 * itself scrolls horizontally — identical rearrangement in all three tables
 * (env / users / cache), ported from the EJS's repeated setTimeout blocks. */
function restructureDataTableWrapper($: any, tableSelector: string, container: HTMLElement) {
  const $wrapper = $(container).find(tableSelector).closest(".dataTables_wrapper");
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

  return { $wrapper, $filter, $length, $info, $paginate };
}

/* ── Copy-icon button — used by the several "copy URL" icons in modals ─── */
function CopyIconButton({
  id,
  getText,
  title,
}: {
  id: string;
  getText: () => string;
  title: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <i
      className={`fa-solid ${copied ? "fa-check" : "fa-copy"}`}
      id={id}
      title={title}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = getText();
        if (!text) return;
        copyToClipboard(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    />
  );
}

// Faithful React port of views/admin/dashboard.ejs.
export default function AdminDashboard() {
  const token = getAccessToken();
  const [config, setConfig] = useState<AppConfig>({ appUrl: "", wrikeRedirectUrl: "" });

  useEffect(() => {
    fetchAppConfig().then(setConfig);
  }, []);

  /* ── Session guard ────────────────────────────────────────────────── */
  useEffect(() => {
    if (!token) {
      window.location.href = "/admin/login";
    }
  }, [token]);

  /* ── Layout state ─────────────────────────────────────────────────── */
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activePage, setActivePage] = useHashPage<PageId>(PAGE_IDS, "overview");

  // Close any open row ⋯ menu when the user switches pages/sections.
  useEffect(() => {
    closeRowMenu();
  }, [activePage]);
  const [refreshing, setRefreshing] = useState(false);

  /* ── Environments ─────────────────────────────────────────────────── */
  const [environments, setEnvironments] = useState<AdminEnvironment[]>([]);
  const [envLoaded, setEnvLoaded] = useState(false);
  const envTableContainerRef = useRef<HTMLDivElement>(null);
  const envDataTableRef = useRef<any>(null);
  // Last-rendered environment list — lets the DataTables effect tell a
  // Visibility/Status flip (in-place update) apart from real structural
  // changes (add/edit/delete → full rebuild).
  const prevEnvsRef = useRef<AdminEnvironment[] | null>(null);

  // API access scope drawer — opened from an environment row's shield
  // button, scoped to that one environment (see EnvironmentAccess.tsx).
  const [accessDrawerEnvId, setAccessDrawerEnvId] = useState<string | null>(null);
  const [accessDrawerEnvName, setAccessDrawerEnvName] = useState<string | null>(null);
  const [accessDrawerOpen, setAccessDrawerOpen] = useState(false);

  function openAccessDrawer(envId: string, envName: string) {
    setAccessDrawerEnvId(envId);
    setAccessDrawerEnvName(envName);
    setAccessDrawerOpen(true);
  }

  const loadEnvironments = async () => {
    window.NProgress?.start();
    try {
      const data = await listEnvironments();
      setEnvironments(data);
    } catch (err) {
      toast("Failed to load environments", "error");
      console.error(err);
    } finally {
      setEnvLoaded(true);
      window.NProgress?.done();
    }
  };

  useEffect(() => {
    window.NProgress?.configure({ showSpinner: false, minimum: 0.15 });
    loadEnvironments();
    loadPortalUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = {
    total: environments.length,
    active: environments.filter((e) => e.is_active).length,
    get inactive() {
      return this.total - this.active;
    },
    withApi: environments.filter((e) => !!e.client_id).length,
  };

  const recentEnvs = environments.slice(0, 5);

  /* Environments table — imperative DataTables bridge (see PortalDashboard
     for the rationale: DataTables restructures the DOM heavily, so we hand
     it a container React never renders children into). */
  useEffect(() => {
    const $ = window.jQuery;
    const container = envTableContainerRef.current;
    if (!$ || !container || !envLoaded) return;

    const prevEnvs = prevEnvsRef.current;
    prevEnvsRef.current = environments;

    // A Visibility/Status flip on the current row set is a one-cell change.
    // Sync the switches in place instead of destroying/rebuilding the
    // DataTable — a rebuild would flicker the whole table and reset the
    // user's search/sort/page. Structural changes (add/edit/delete) fall
    // through to the full rebuild below.
    if (
      envDataTableRef.current &&
      prevEnvs &&
      envsDifferOnlyByToggles(prevEnvs, environments)
    ) {
      environments.forEach((env) => {
        (["is_visible", "is_active"] as const).forEach((field) => {
          const input = container.querySelector<HTMLInputElement>(
            `.env-toggle[data-id="${env.id}"][data-field="${field}"]`,
          );
          if (input) input.checked = !!env[field];
        });
      });
      return;
    }

    if (envDataTableRef.current) {
      envDataTableRef.current.destroy();
      envDataTableRef.current = null;
    }

    const $container = $(container).empty();

    if (environments.length === 0) {
      $container.html(
        `<table class="dt" id="envTable">${ENV_TABLE_HEAD}<tbody>` +
          '<tr><td colspan="7">' +
          '<div class="empty-state">' +
          '<div class="empty-state-icon"><i class="fa-regular fa-folder-open"></i></div>' +
          "<h3>No environments found</h3>" +
          '<p>Click "Add Environment" to create the first one.</p>' +
          "</div>" +
          "</td></tr>" +
          "</tbody></table>",
      );
      return;
    }

    const rowsHtml = environments.map(envRowHtml).join("");
    $container.html(`<table class="dt" id="envTable">${ENV_TABLE_HEAD}<tbody>${rowsHtml}</tbody></table>`);

    envDataTableRef.current = $container.find("#envTable").DataTable({
      pageLength: 10,
      lengthMenu: [5, 10, 25, 50],
      order: [],
      columnDefs: [
        // Visibility/Status are now toggle switches, not sortable/searchable
        // text — an orderable header on a checkbox column reorders nothing
        // visible and just confuses. Columns: 0 Environment (name+ID),
        // 1 Client ID, 2 Created, 3 Last Updated, 4 Visibility, 5 Status,
        // 6 Actions.
        { targets: [4, 5], orderable: false, searchable: false },
        { targets: 6, orderable: false, searchable: false },
      ],
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
      restructureDataTableWrapper($, "#envTable", container);
    }, 10);

    return () => clearTimeout(layoutTimer);
  }, [environments, envLoaded]);

  /* Delegated click handlers for the env table's action buttons. */
  useEffect(() => {
    const $ = window.jQuery;
    const container = envTableContainerRef.current;
    if (!$ || !container) return;

    const onCopy = function (this: HTMLElement) {
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
    const onRowMenu = function (this: HTMLElement) {
      const id = String($(this).data("id"));
      const name = String($(this).data("name") || "");
      if (this.classList.contains("row-menu-open")) {
        closeRowMenu();
        return;
      }
      openRowMenu(this, [
        {
          label: "API access scope",
          icon: "fa-solid fa-shield-halved",
          onClick: () => openAccessDrawer(id, name),
        },
        { label: "Edit", icon: "fa-solid fa-pen-to-square", onClick: () => openEditModal(id) },
        {
          label: "Duplicate",
          icon: "fa-regular fa-clone",
          onClick: () => openDuplicateModal(id),
        },
        {
          label: "Delete",
          icon: "fa-solid fa-trash",
          danger: true,
          onClick: () => confirmDeleteEnvironment(id, name),
        },
      ]);
    };
    const onToggle = function (this: HTMLInputElement) {
      const field = $(this).data("field") as "is_active" | "is_visible";
      handleEnvToggle(this, String($(this).data("id")), field);
    };

    $(container).on("click", ".copy-id-btn", onCopy);
    $(container).on("click", ".row-menu-trigger", onRowMenu);
    $(container).on("change", ".env-toggle", onToggle);
    return () => {
      $(container).off("click", ".copy-id-btn", onCopy);
      $(container).off("click", ".row-menu-trigger", onRowMenu);
      $(container).off("change", ".env-toggle", onToggle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environments]);

  /* Delegated click handlers for the recent-envs (overview) copy/edit/dup
     buttons — same JSX-rendered table, but action-cell buttons are wired
     with a small ref-scoped delegation, matching the env table above. */
  const recentEnvsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const $ = window.jQuery;
    const container = recentEnvsRef.current;
    if (!$ || !container) return;

    const onCopy = function (this: HTMLElement) {
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
    const onEdit = function (this: HTMLElement) {
      openEditModal($(this).data("id"));
    };
    const onDup = function (this: HTMLElement) {
      openDuplicateModal($(this).data("id"));
    };
    const onAccess = function (this: HTMLElement) {
      openAccessDrawer(String($(this).data("id")), String($(this).data("name")));
    };

    $(container).on("click", ".copy-id-btn", onCopy);
    $(container).on("click", ".access-btn", onAccess);
    $(container).on("click", ".edit-btn", onEdit);
    $(container).on("click", ".dup-btn", onDup);
    return () => {
      $(container).off("click", ".copy-id-btn", onCopy);
      $(container).off("click", ".access-btn", onAccess);
      $(container).off("click", ".edit-btn", onEdit);
      $(container).off("click", ".dup-btn", onDup);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environments]);

  /* ── Environment modal (add / edit / duplicate) ──────────────────────── */
  const [envModalOpen, setEnvModalOpen] = useState(false);
  const [envModalMode, setEnvModalMode] = useState<"add" | "edit" | "duplicate">("add");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [envForm, setEnvForm] = useState<EnvFormState>(EMPTY_ENV_FORM);
  const [envSaving, setEnvSaving] = useState(false);
  const [duplicateSourceId, setDuplicateSourceId] = useState<string | null>(null);
  const envNameInputRef = useRef<HTMLInputElement>(null);
  const clientIdInputRef = useRef<HTMLInputElement>(null);

  const modalTitle =
    envModalMode === "add"
      ? "Add Environment"
      : envModalMode === "duplicate"
        ? `Duplicate: ${environments.find((e) => e.id === duplicateSourceId)?.environment_name ?? ""}`
        : `Edit: ${environments.find((e) => e.id === editingId)?.environment_name ?? ""}`;

  function openAddModal() {
    setEditingId(null);
    setDuplicateSourceId(null);
    setEnvModalMode("add");
    setEnvForm(EMPTY_ENV_FORM);
    setEnvModalOpen(true);
    setTimeout(() => envNameInputRef.current?.focus(), 120);
  }

  function openEditModal(id: string) {
    const env = environments.find((e) => e.id === id);
    if (!env) return;
    setEditingId(id);
    setDuplicateSourceId(null);
    setEnvModalMode("edit");
    setEnvForm(envToForm(env));
    setEnvModalOpen(true);
    setTimeout(() => clientIdInputRef.current?.focus(), 120);
  }

  function openDuplicateModal(id: string) {
    const env = environments.find((e) => e.id === id);
    if (!env) return;
    setEditingId(null);
    setDuplicateSourceId(id);
    setEnvModalMode("duplicate");
    setEnvForm(envToDuplicateForm(env));
    setEnvModalOpen(true);
    setTimeout(() => clientIdInputRef.current?.focus(), 120);
  }

  function closeEnvModal() {
    setEnvModalOpen(false);
    setEditingId(null);
    setDuplicateSourceId(null);
  }

  const wrikeRedirectUrl = config.wrikeRedirectUrl;
  const appUrl = config.appUrl;

  const showRedirectSectionInModal =
    envModalMode === "edit" && !!wrikeRedirectUrl && !!editingId && !!appUrl;
  const editModalLoginUrl = editingId && appUrl ? `${appUrl}?environmentId=${editingId}` : "";

  async function handleSaveEnvironment() {
    const f = envForm;
    const trimmed = {
      environment_name: f.environment_name.trim(),
      client_id: f.client_id.trim(),
      client_secret: f.client_secret.trim(),
      account_id: f.account_id.trim(),
      xpi_api_modules_datahub_id: f.xpi_api_modules_datahub_id.trim(),
      xpi_api_services_datahub_id: f.xpi_api_services_datahub_id.trim(),
      xpi_entity_datahub_id: f.xpi_entity_datahub_id.trim(),
      xpi_field_mapping_datahub_id: f.xpi_field_mapping_datahub_id.trim(),
      xpi_request_form_field_mapping_datahub_id: f.xpi_request_form_field_mapping_datahub_id.trim(),
      xpi_request_form_mapping_datahub_id: f.xpi_request_form_mapping_datahub_id.trim(),
      xpi_space_name_datahub_id: f.xpi_space_name_datahub_id.trim(),
      campaign_space_id: f.campaign_space_id.trim(),
    };

    if (!trimmed.environment_name) return toast("Environment name is required", "error");
    if (!trimmed.client_id) return toast("Client ID is required", "error");
    if (!trimmed.client_secret) return toast("Client Secret is required", "error");
    if (!trimmed.xpi_api_modules_datahub_id)
      return toast("XPI API Modules Datahub ID is required", "error");
    if (!trimmed.xpi_api_services_datahub_id)
      return toast("XPI API Services Datahub ID is required", "error");
    if (!trimmed.xpi_entity_datahub_id) return toast("XPI Entity Datahub ID is required", "error");
    if (!trimmed.xpi_field_mapping_datahub_id)
      return toast("XPI Field Mapping Datahub ID is required", "error");
    if (!trimmed.xpi_request_form_field_mapping_datahub_id)
      return toast("XPI Request Form Field Mapping Datahub ID is required", "error");
    if (!trimmed.xpi_request_form_mapping_datahub_id)
      return toast("XPI Request Form Mapping Datahub ID is required", "error");
    if (!trimmed.xpi_space_name_datahub_id)
      return toast("XPI Space Name Datahub ID is required", "error");
    if (!trimmed.campaign_space_id) return toast("Campaign Space ID is required", "error");

    setEnvSaving(true);
    try {
      const payload = { ...trimmed, is_visible: f.is_visible, is_active: f.is_active };
      const result = editingId
        ? await updateEnvironment(editingId, payload)
        : await createEnvironment(payload);

      if (!editingId && wrikeRedirectUrl && appUrl && result?.id) {
        const redirectUrl = wrikeRedirectUrl;
        const loginUrl = appUrl + "?environmentId=" + result.id;
        setTimeout(() => showRedirectUrlModal(redirectUrl, loginUrl), 300);
      } else {
        toast("Environment " + (editingId ? "updated" : "created") + " successfully", "success");
      }

      closeEnvModal();
      await loadEnvironments();
    } catch (err: any) {
      toast(err?.message || "An error occurred", "error");
    } finally {
      setEnvSaving(false);
    }
  }

  async function confirmDeleteEnvironment(id: string, name: string) {
    const Swal = window.Swal;
    const result = Swal
      ? await Swal.fire({
          title: "Delete Environment?",
          html: "This will permanently remove <strong>" + escHtml(name) + "</strong>. This cannot be undone.",
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: '<i class="fa-solid fa-trash" style="margin-right:6px"></i>Delete',
          cancelButtonText: "Cancel",
          focusConfirm: false,
          reverseButtons: true,
          customClass: { confirmButton: "swal2-confirm swal2-danger", cancelButton: "swal2-cancel" },
        })
      : { isConfirmed: true };

    if (!result.isConfirmed) return;

    window.NProgress?.start();
    try {
      await deleteEnvironment(id);
      toast("Environment deleted", "success");
      await loadEnvironments();
    } catch (err: any) {
      toast(err?.message || "Delete failed", "error");
    } finally {
      window.NProgress?.done();
    }
  }

  // Flips one switch (Visibility or Status) from the Environments list —
  // optimistic, with no full table reload and no list re-fetch: the switch
  // stays where the user put it, React state is updated so the rest of the
  // dashboard (stats, recent list, edit modal) stays consistent, and the
  // DataTables effect syncs that single cell in place. On failure the switch
  // is rolled back.
  async function handleEnvToggle(
    checkboxEl: HTMLInputElement,
    id: string,
    field: "is_active" | "is_visible",
  ) {
    const next = checkboxEl.checked;
    const wrap = checkboxEl.closest(".toggle-wrap") as HTMLElement | null;
    checkboxEl.disabled = true;
    // Show a small spinner on the switch while the status PATCH is in flight.
    wrap?.classList.add("toggle-busy");

    try {
      await toggleEnvironmentStatus(id, { [field]: next });
      setEnvironments((prev) =>
        prev.map((env) => (env.id === id ? { ...env, [field]: next } : env)),
      );
      toast(
        field === "is_active"
          ? next
            ? "Environment enabled"
            : "Environment disabled"
          : next
            ? "Environment is now visible"
            : "Environment is now hidden",
        "success",
      );
    } catch (err: any) {
      checkboxEl.checked = !next;
      toast(err?.message || "Update failed", "error");
    } finally {
      checkboxEl.disabled = false;
      wrap?.classList.remove("toggle-busy");
    }
  }

  /* ── Redirect URL success modal ──────────────────────────────────────── */
  const [redirectModalOpen, setRedirectModalOpen] = useState(false);
  const [redirectModalUrls, setRedirectModalUrls] = useState({ redirectUrl: "", loginUrl: "" });
  const [countdown, setCountdown] = useState(8);
  const countdownIntervalRef = useRef<number | null>(null);

  function showRedirectUrlModal(redirectUrl: string, loginUrl: string) {
    setRedirectModalUrls({ redirectUrl, loginUrl });
    setCountdown(8);
    setRedirectModalOpen(true);
  }

  function closeRedirectUrlModal() {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setRedirectModalOpen(false);
  }

  useEffect(() => {
    if (!redirectModalOpen) return;
    countdownIntervalRef.current = window.setInterval(() => {
      setCountdown((s) => {
        if (s <= 1) {
          if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
          setRedirectModalOpen(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [redirectModalOpen]);

  /* ── Portal users ─────────────────────────────────────────────────── */
  const [puUsers, setPuUsers] = useState<PortalUser[]>([]);
  // Mirrors envLoaded for the environments table — the users DataTable is
  // only painted after the first list fetch has resolved, so it never
  // flashes the "No portal users found" empty state while loading.
  const [puLoaded, setPuLoaded] = useState(false);
  const puTableContainerRef = useRef<HTMLDivElement>(null);

  // Module-permission modal — opened from a user row's shield-icon button.
  const [permsUserId, setPermsUserId] = useState<string | null>(null);
  const [permsUsername, setPermsUsername] = useState<string | null>(null);
  const [permsOpen, setPermsOpen] = useState(false);

  function openPortalUserPermissions(userId: string, username: string) {
    setPermsUserId(userId);
    setPermsUsername(username);
    setPermsOpen(true);
  }
  const puDataTableRef = useRef<any>(null);

  const loadPortalUsers = async () => {
    try {
      const data = await listPortalUsers();
      setPuUsers(data);
    } catch (err: any) {
      toast(err?.message || "Failed to load portal users", "error");
    } finally {
      setPuLoaded(true);
    }
  };

  useEffect(() => {
    const $ = window.jQuery;
    const container = puTableContainerRef.current;
    // Don't paint anything (not even the "no users" empty state) until the
    // first load has resolved — mirrors the env table's envLoaded gate so
    // the page never flashes a false empty table while data is loading.
    if (!$ || !container || !puLoaded) return;

    if (puDataTableRef.current) {
      puDataTableRef.current.destroy();
      puDataTableRef.current = null;
    }

    const $container = $(container).empty();

    if (!puUsers.length) {
      $container.html(
        `<table class="dt" id="puTable">${PU_TABLE_HEAD}<tbody>` +
          '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted);">' +
          '<i class="fa-solid fa-users" style="font-size:24px;display:block;margin-bottom:10px;opacity:0.3;"></i>No portal users found.</td></tr>' +
          "</tbody></table>",
      );
      return;
    }

    const rowsHtml = puUsers.map(puRowHtml).join("");
    $container.html(`<table class="dt" id="puTable">${PU_TABLE_HEAD}<tbody>${rowsHtml}</tbody></table>`);

    puDataTableRef.current = $container.find("#puTable").DataTable({
      pageLength: 10,
      order: [[0, "asc"]],
      language: {
        search: "",
        searchPlaceholder: "Search users…",
        lengthMenu: "Show _MENU_ rows",
        info: "Showing _START_–_END_ of _TOTAL_",
        paginate: { previous: "‹", next: "›" },
      },
      columnDefs: [{ targets: 7, orderable: false }],
    });

    const layoutTimer = setTimeout(() => {
      restructureDataTableWrapper($, "#puTable", container);
    }, 10);

    return () => clearTimeout(layoutTimer);
  }, [puUsers, puLoaded]);

  useEffect(() => {
    const $ = window.jQuery;
    const container = puTableContainerRef.current;
    if (!$ || !container) return;

    const onRowMenu = function (this: HTMLElement) {
      const id = String($(this).data("id"));
      const username = String($(this).data("username") || "");
      const active = $(this).data("active") === true || $(this).data("active") === "true";
      if (this.classList.contains("row-menu-open")) {
        closeRowMenu();
        return;
      }
      openRowMenu(this, [
        {
          label: "Permissions",
          icon: "fa-solid fa-user-shield",
          onClick: () => openPortalUserPermissions(id, username),
        },
        { label: "Edit", icon: "fa-solid fa-pen-to-square", onClick: () => puOpenEdit(id) },
        {
          label: "Reset Password",
          icon: "fa-solid fa-key",
          onClick: () => puOpenReset(id, username),
        },
        {
          label: "Manage Environments",
          icon: "fa-solid fa-plug",
          onClick: () => puOpenAssignEnv(id, username),
        },
        active
          ? {
              label: "Disable",
              icon: "fa-solid fa-ban",
              danger: true,
              onClick: () => puToggleStatus(id, false),
            }
          : {
              label: "Enable",
              icon: "fa-solid fa-circle-check",
              onClick: () => puToggleStatus(id, true),
            },
      ]);
    };

    $(container).on("click", ".row-menu-trigger", onRowMenu);
    return () => {
      $(container).off("click", ".row-menu-trigger", onRowMenu);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puUsers]);

  /* ── Add portal user modal ───────────────────────────────────────── */
  const [puAddModalOpen, setPuAddModalOpen] = useState(false);
  const [puUsername, setPuUsername] = useState("");
  const [puFullName, setPuFullName] = useState("");
  const [puEmail, setPuEmail] = useState("");
  const [puPassword, setPuPassword] = useState("");
  const [puPasswordVisible, setPuPasswordVisible] = useState(false);
  const [puSaving, setPuSaving] = useState(false);
  const [puGenLoading, setPuGenLoading] = useState(false);

  function openAddUserModal() {
    setPuUsername("");
    setPuFullName("");
    setPuEmail("");
    setPuPassword("");
    setPuPasswordVisible(false);
    setPuAddModalOpen(true);
  }

  async function handleGenerateCreds() {
    setPuGenLoading(true);
    try {
      const creds = await generatePortalUserCredentials();
      setPuUsername(creds.username);
      setPuPassword(creds.password);
      setPuPasswordVisible(true);
      toast("Credentials generated", "success");
    } catch (err: any) {
      toast(err?.message || "Failed to generate credentials", "error");
    } finally {
      setPuGenLoading(false);
    }
  }

  async function handleSaveUser() {
    const username = puUsername.trim();
    const password = puPassword;
    const role = "user";
    const full_name = puFullName.trim();
    const email = puEmail.trim();

    if (!username || !password || !role) {
      toast("Username, password and role are required", "error");
      return;
    }
    if (password.length < 10 || password.length > 16) {
      toast("Password must be 10 to 16 characters", "error");
      return;
    }

    setPuSaving(true);
    try {
      await createPortalUser({
        username,
        password,
        role,
        full_name: full_name || undefined,
        email: email || undefined,
      });
      toast("User created successfully", "success");
      setPuAddModalOpen(false);
      await loadPortalUsers();
    } catch (err: any) {
      toast(err?.message, "error");
    } finally {
      setPuSaving(false);
    }
  }

  /* ── Edit portal user modal ──────────────────────────────────────── */
  const [puEditModalOpen, setPuEditModalOpen] = useState(false);
  const [puEditId, setPuEditId] = useState<string | null>(null);
  const [puEditUsernameDisplay, setPuEditUsernameDisplay] = useState("");
  const [puEditUsernameInput, setPuEditUsernameInput] = useState("");
  const [puEditFullName, setPuEditFullName] = useState("");
  const [puEditEmail, setPuEditEmail] = useState("");
  const [puEditSaving, setPuEditSaving] = useState(false);
  const [puEditGenLoading, setPuEditGenLoading] = useState(false);

  function puOpenEdit(userId: string) {
    const user = puUsers.find((u) => u.id === userId);
    if (!user) return;
    setPuEditId(userId);
    setPuEditUsernameDisplay(user.username);
    setPuEditUsernameInput(user.username);
    setPuEditFullName(user.full_name || "");
    setPuEditEmail(user.email || "");
    setPuEditModalOpen(true);
  }

  async function handleEditGenUsername() {
    setPuEditGenLoading(true);
    try {
      const creds = await generatePortalUserCredentials();
      setPuEditUsernameInput(creds.username);
      toast("Username generated", "success");
    } catch (err: any) {
      toast(err?.message || "Failed to generate username", "error");
    } finally {
      setPuEditGenLoading(false);
    }
  }

  async function handleSaveEditUser() {
    if (!puEditId) return;
    const username = puEditUsernameInput.trim();
    const full_name = puEditFullName.trim();
    const email = puEditEmail.trim();

    setPuEditSaving(true);
    try {
      await updatePortalUser(puEditId, {
        username: username || undefined,
        full_name: full_name || null,
        email: email || null,
      });
      toast("User updated successfully", "success");
      setPuEditModalOpen(false);
      await loadPortalUsers();
    } catch (err: any) {
      toast(err?.message, "error");
    } finally {
      setPuEditSaving(false);
    }
  }

  /* ── Reset password modal ────────────────────────────────────────── */
  const [puResetModalOpen, setPuResetModalOpen] = useState(false);
  const [puResetId, setPuResetId] = useState<string | null>(null);
  const [puResetUsername, setPuResetUsername] = useState("");
  const [puResetPwdInput, setPuResetPwdInput] = useState("");
  const [puResetPwdVisible, setPuResetPwdVisible] = useState(false);
  const [puResetSaving, setPuResetSaving] = useState(false);

  function puOpenReset(userId: string, username: string) {
    setPuResetId(userId);
    setPuResetUsername(username);
    setPuResetPwdInput("");
    setPuResetPwdVisible(false);
    setPuResetModalOpen(true);
  }

  async function handleConfirmReset() {
    if (!puResetId) return;
    if (!puResetPwdInput || puResetPwdInput.length < 8) {
      toast("Password must be at least 8 characters", "error");
      return;
    }
    setPuResetSaving(true);
    try {
      await resetPortalUserPassword(puResetId, puResetPwdInput);
      toast("Password reset successfully", "success");
      setPuResetModalOpen(false);
      await loadPortalUsers();
    } catch (err: any) {
      toast(err?.message, "error");
    } finally {
      setPuResetSaving(false);
    }
  }

  async function puToggleStatus(userId: string, is_active: boolean) {
    const Swal = window.Swal;
    const confirmed = Swal
      ? await Swal.fire({
          title: (is_active ? "Enable" : "Disable") + " user?",
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: is_active ? "Enable" : "Disable",
          confirmButtonColor: is_active ? "#008262" : "#ef4444",
        })
      : { isConfirmed: true };
    if (!confirmed.isConfirmed) return;

    try {
      await togglePortalUserStatus(userId, is_active);
      toast("User " + (is_active ? "enabled" : "disabled"), "success");
      await loadPortalUsers();
    } catch (err: any) {
      toast(err?.message, "error");
    }
  }

  /* ── Assign environments modal ───────────────────────────────────── */
  const [puAssignModalOpen, setPuAssignModalOpen] = useState(false);
  const [puAssignId, setPuAssignId] = useState<string | null>(null);
  const [puAssignUsername, setPuAssignUsername] = useState("");
  const [puAssignedEnvs, setPuAssignedEnvs] = useState<AdminEnvironment[] | null>(null);
  const [puUnassignedEnvs, setPuUnassignedEnvs] = useState<AdminEnvironment[]>([]);
  const [puAssignSelectValue, setPuAssignSelectValue] = useState("");
  const [puAssignAdding, setPuAssignAdding] = useState(false);
  const [puAssignLoadError, setPuAssignLoadError] = useState(false);

  async function puOpenAssignEnv(userId: string, username: string) {
    setPuAssignId(userId);
    setPuAssignUsername(username);
    setPuAssignModalOpen(true);
    await puLoadEnvModal(userId);
  }

  async function puLoadEnvModal(userId: string) {
    setPuAssignedEnvs(null);
    setPuAssignLoadError(false);
    setPuAssignSelectValue("");
    try {
      const [userEnvs, allCreds] = await Promise.all([
        getPortalUserEnvironments(userId),
        listEnvironments(),
      ]);
      const unassigned = allCreds.filter((e) => !e.owner_id && e.is_active && !e.deleted_at);
      setPuAssignedEnvs(userEnvs);
      setPuUnassignedEnvs(unassigned);
    } catch {
      setPuAssignLoadError(true);
    }
  }

  async function puRevokeEnv(userId: string, environmentId: string) {
    try {
      await revokePortalUserEnvironment(userId, environmentId);
      toast("Environment revoked", "success");
      await puLoadEnvModal(userId);
    } catch (err: any) {
      toast(err?.message, "error");
    }
  }

  async function handleAddEnvToUser() {
    if (!puAssignId) return;
    if (!puAssignSelectValue) {
      toast("Select an environment first", "warning");
      return;
    }
    setPuAssignAdding(true);
    try {
      await assignPortalUserEnvironment(puAssignId, puAssignSelectValue);
      toast("Environment assigned", "success");
      await puLoadEnvModal(puAssignId);
    } catch (err: any) {
      toast(err?.message, "error");
    } finally {
      setPuAssignAdding(false);
    }
  }

  /* ── Dead-in-the-original "Generated Credentials" modal ─────────────
     views/admin/dashboard.ejs ships this modal's markup (#puGenCredsModalBackdrop)
     but never wires anything to open it — the real "Auto Fill" flow (above)
     fills the Add User form directly. Kept here, inert, for visual fidelity. */
  const [puGenCredsModalOpen, setPuGenCredsModalOpen] = useState(false);

  /* ── Cache settings ──────────────────────────────────────────────── */
  const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]);
  const [selectedCacheKeys, setSelectedCacheKeys] = useState<Set<string>>(new Set());
  const [cacheSearchPattern, setCacheSearchPattern] = useState("");
  const cacheTableContainerRef = useRef<HTMLDivElement>(null);
  const cacheDataTableRef = useRef<any>(null);
  const cacheSearchDebounceRef = useRef<number | null>(null);
  const cacheSearchPatternRef = useRef(cacheSearchPattern);
  cacheSearchPatternRef.current = cacheSearchPattern;

  const loadCacheEntries = async (patternOverride?: string) => {
    const normalizedPattern =
      typeof patternOverride === "string" ? patternOverride.trim() : cacheSearchPatternRef.current;

    if (cacheSearchDebounceRef.current) {
      clearTimeout(cacheSearchDebounceRef.current);
      cacheSearchDebounceRef.current = null;
    }
    setCacheSearchPattern(normalizedPattern);

    window.NProgress?.start();
    try {
      const entries = await listCacheEntries(normalizedPattern);
      setCacheEntries(entries);
      setSelectedCacheKeys(new Set());
    } catch (err: any) {
      setCacheEntries([]);
      setSelectedCacheKeys(new Set());
      toast(err?.message || "Failed to load cache data", "error");
    } finally {
      window.NProgress?.done();
    }
  };

  useEffect(() => {
    const $ = window.jQuery;
    const container = cacheTableContainerRef.current;
    if (!$ || !container) return;

    if (cacheDataTableRef.current) {
      cacheDataTableRef.current.destroy();
      cacheDataTableRef.current = null;
    }

    const $container = $(container).empty();
    const rowsHtml = cacheEntries.map(cacheRowHtml).join("");
    $container.html(`<table class="dt" id="cacheTable">${CACHE_TABLE_HEAD}<tbody>${rowsHtml}</tbody></table>`);

    cacheDataTableRef.current = $container.find("#cacheTable").DataTable({
      pageLength: 10,
      lengthMenu: [10, 25, 50, 100],
      order: [],
      columnDefs: [
        { targets: 0, orderable: false, searchable: false },
        { targets: 5, orderable: false, searchable: false },
      ],
      language: {
        emptyTable: "No cache entries found",
        zeroRecords: "No matching cache keys",
        lengthMenu: "Show _MENU_ keys",
        search: "",
        searchPlaceholder: "Search cache keys…",
        info: "Showing _START_–_END_ of _TOTAL_",
        paginate: { previous: "‹", next: "›" },
      },
    });

    const layoutTimer = setTimeout(() => {
      const { $filter } = restructureDataTableWrapper($, "#cacheTable", container);
      const $wrapper = $(container).find(".dataTables_wrapper");
      $wrapper.find(".dataTables_length").css("display", "flex");
      $filter.css("display", "flex");
      $wrapper.find(".dataTables_info").css("display", "block");
      $wrapper.find(".dataTables_paginate").css("display", "flex");

      const $searchInput = $filter.find("input");
      $searchInput.val(cacheSearchPatternRef.current);
      $searchInput.attr("placeholder", "Search cache keys / patterns…");
      $searchInput.attr("type", "search");
      $searchInput.attr("name", "cache_key_search");
      $searchInput.attr("autocomplete", "off");
      $searchInput.attr("autocorrect", "off");
      $searchInput.attr("autocapitalize", "off");
      $searchInput.attr("spellcheck", "false");
      $searchInput.attr("data-form-type", "other");
      $searchInput.attr("data-lpignore", "true");
      $searchInput.attr("data-1p-ignore", "true");
      $searchInput.off(".DT");
      $searchInput.off("input.cacheServerSearch");
      $searchInput.on("input.cacheServerSearch", function (this: HTMLInputElement) {
        const nextPattern = (this.value || "").trim();
        if (cacheSearchDebounceRef.current) clearTimeout(cacheSearchDebounceRef.current);
        cacheSearchDebounceRef.current = window.setTimeout(() => {
          loadCacheEntries(nextPattern);
        }, CACHE_SEARCH_DEBOUNCE_MS);
      });
    }, 10);

    return () => clearTimeout(layoutTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheEntries]);

  /* Cache selection + row action delegation. */
  useEffect(() => {
    const $ = window.jQuery;
    const container = cacheTableContainerRef.current;
    if (!$ || !container) return;

    const onSelectAll = function (this: HTMLInputElement) {
      const checked = this.checked;
      const next = new Set<string>();
      $(container)
        .find(".cache-row-check")
        .each(function (this: HTMLInputElement) {
          this.checked = checked;
          if (checked) next.add(decodeURIComponent($(this).data("key")));
        });
      setSelectedCacheKeys(next);
    };

    const onRowCheck = function (this: HTMLInputElement) {
      const key = decodeURIComponent($(this).data("key"));
      setSelectedCacheKeys((prev) => {
        const next = new Set(prev);
        if (this.checked) next.add(key);
        else next.delete(key);
        return next;
      });
    };

    const onView = async function (this: HTMLElement, e: any) {
      e.preventDefault();
      e.stopPropagation();
      const key = decodeURIComponent($(this).data("key"));
      await openCacheDetailModal(key);
    };

    const onDelete = async function (this: HTMLElement, e: any) {
      e.preventDefault();
      e.stopPropagation();
      const key = decodeURIComponent($(this).data("key"));
      try {
        await deleteCacheKeyWithConfirm(key);
      } catch (err: any) {
        toast(err?.message || "Failed to delete cache key", "error");
      }
    };

    $(container).on("change", "#cacheSelectAll", onSelectAll);
    $(container).on("change", ".cache-row-check", onRowCheck);
    $(container).on("click", ".cache-view-btn", onView);
    $(container).on("click", ".cache-delete-btn", onDelete);
    return () => {
      $(container).off("change", "#cacheSelectAll", onSelectAll);
      $(container).off("change", ".cache-row-check", onRowCheck);
      $(container).off("click", ".cache-view-btn", onView);
      $(container).off("click", ".cache-delete-btn", onDelete);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheEntries]);

  /* Reflect selection state onto the (imperatively-rendered) checkboxes. */
  useEffect(() => {
    const $ = window.jQuery;
    const container = cacheTableContainerRef.current;
    if (!$ || !container) return;
    const allCount = cacheEntries.length;
    const selectedCount = selectedCacheKeys.size;
    $(container)
      .find(".cache-row-check")
      .each(function (this: HTMLInputElement) {
        const key = decodeURIComponent($(this).data("key"));
        this.checked = selectedCacheKeys.has(key);
      });
    const $selectAll = $(container).find("#cacheSelectAll");
    if ($selectAll.length) {
      ($selectAll[0] as HTMLInputElement).checked = allCount > 0 && allCount === selectedCount;
    }
  }, [selectedCacheKeys, cacheEntries]);

  async function deleteCacheKeyWithConfirm(key: string) {
    const Swal = window.Swal;
    const decision = Swal
      ? await Swal.fire({
          title: "Delete Cache Key?",
          html: `This will remove <strong>${escHtml(key)}</strong> from Redis.`,
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: '<i class="fa-solid fa-trash" style="margin-right:6px"></i>Delete',
          cancelButtonText: "Cancel",
          reverseButtons: true,
        })
      : { isConfirmed: true };
    if (!decision.isConfirmed) return;

    await deleteCacheEntry(key);
    toast("Cache key deleted", "success");
    await loadCacheEntries(cacheSearchPatternRef.current);
  }

  const [cacheBulkDeleting, setCacheBulkDeleting] = useState(false);

  async function handleCacheBulkDelete() {
    const keys = selectedCacheKeys.size > 0 ? Array.from(selectedCacheKeys) : cacheEntries.map((e) => e.key);
    if (!keys.length) return;

    const isDeleteAll = selectedCacheKeys.size === 0;
    const Swal = window.Swal;
    const decision = Swal
      ? await Swal.fire({
          title: isDeleteAll ? "Delete All Cache Keys?" : "Delete Selected Cache Keys?",
          html: `You are deleting <strong>${keys.length}</strong> key(s).`,
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: `<i class="fa-solid fa-trash" style="margin-right:6px"></i>${isDeleteAll ? "Delete All" : "Delete Selected"}`,
          cancelButtonText: "Cancel",
          reverseButtons: true,
        })
      : { isConfirmed: true };
    if (!decision.isConfirmed) return;

    setCacheBulkDeleting(true);
    try {
      const json = await bulkDeleteCacheEntries(keys);
      toast(json?.message || "Cache keys deleted", "success");
      await loadCacheEntries(cacheSearchPatternRef.current);
    } catch (err: any) {
      toast(err?.message || "Bulk delete failed", "error");
    } finally {
      setCacheBulkDeleting(false);
    }
  }

  /* ── Cache detail modal ──────────────────────────────────────────── */
  const [cacheDetailModalOpen, setCacheDetailModalOpen] = useState(false);
  const [cacheDetailKey, setCacheDetailKey] = useState<string | null>(null);
  const [cacheDetailType, setCacheDetailType] = useState("");
  const [cacheDetailTtl, setCacheDetailTtl] = useState("");
  const [cacheDetailValue, setCacheDetailValue] = useState("");

  async function openCacheDetailModal(key: string) {
    setCacheDetailKey(key);
    setCacheDetailType("Loading…");
    setCacheDetailTtl("Loading…");
    setCacheDetailValue("Loading…");
    setCacheDetailModalOpen(true);

    try {
      const detail = await getCacheDetail(key);
      setCacheDetailType(`${detail.redis_type || "unknown"} / ${detail.value_type || "unknown"}`);
      setCacheDetailTtl(detail.ttl_label || "Unavailable");
      const pretty =
        typeof detail.value === "string" ? detail.value : JSON.stringify(detail.value, null, 2);
      setCacheDetailValue(pretty || "(empty)");
    } catch (err: any) {
      setCacheDetailValue(err?.message || "Failed to load detail");
      toast(err?.message || "Failed to load cache detail", "error");
    }
  }

  function closeCacheDetailModal() {
    setCacheDetailKey(null);
    setCacheDetailModalOpen(false);
  }

  async function handleCacheDetailDelete() {
    if (!cacheDetailKey) return;
    try {
      await deleteCacheKeyWithConfirm(cacheDetailKey);
      closeCacheDetailModal();
    } catch (err: any) {
      toast(err?.message || "Failed to delete cache key", "error");
    }
  }

  /* ── Escape key closes the env + cache-detail modals ─────────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeEnvModal();
        closeCacheDetailModal();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  /* ── Navigation ───────────────────────────────────────────────────── */
  function handleNav(pageId: PageId) {
    setActivePage(pageId);
    setMobileOpen(false);

    if (pageId === "users") loadPortalUsers();
    if (pageId === "cache-settings") loadCacheEntries(cacheSearchPatternRef.current);
  }

  function handleRefresh() {
    setRefreshing(true);
    const refreshPromise =
      activePage === "cache-settings"
        ? loadCacheEntries(cacheSearchPatternRef.current)
        : activePage === "users"
          ? loadPortalUsers()
          : loadEnvironments();

    Promise.resolve(refreshPromise).finally(() => setTimeout(() => setRefreshing(false), 600));
  }

  async function handleLogout() {
    const Swal = window.Swal;
    const result = Swal
      ? await Swal.fire({
          title: "Sign out?",
          html: "You will be logged out of the admin panel.",
          icon: "question",
          showCancelButton: true,
          confirmButtonText: '<i class="fa-solid fa-right-from-bracket" style="margin-right:6px"></i>Sign Out',
          cancelButtonText: "Stay",
          focusConfirm: false,
          reverseButtons: true,
          customClass: { confirmButton: "swal2-confirm", cancelButton: "swal2-cancel" },
        })
      : { isConfirmed: true };

    if (!result.isConfirmed) return;

    window.NProgress?.start();
    try {
      await adminLogout();
    } catch {
      clearAdminSession();
    } finally {
      window.location.href = "/admin/login";
    }
  }

  const pageTitle = PAGE_NAMES[activePage];
  const cacheAllCount = cacheEntries.length;
  const cacheSelectedCount = selectedCacheKeys.size;
  const bulkDeleteLabel =
    cacheAllCount === 0
      ? "Delete All"
      : cacheSelectedCount > 0
        ? `Delete Selected (${cacheSelectedCount})`
        : "Delete All";

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
              <span className="sub">Admin Portal</span>
            </div>
          </a>
          <button className="sidebar-collapse-btn" title="Collapse sidebar" onClick={() => setCollapsed((v) => !v)}>
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

          <div className="nav-group-label" style={{ marginTop: 6 }}>
            Management
          </div>

          <div className={`nav-item${activePage === "users" ? " active" : ""}`} onClick={() => handleNav("users")}>
            <span className="ni">
              <i className="fa-solid fa-users" />
            </span>
            <span className="nl">Users</span>
          </div>

          <div className="nav-group-label" style={{ marginTop: 6 }}>
            Settings
          </div>

          <div
            className={`nav-item${activePage === "cache-settings" ? " active" : ""}`}
            onClick={() => handleNav("cache-settings")}
          >
            <span className="ni">
              <i className="fa-solid fa-database" />
            </span>
            <span className="nl">Cache Settings</span>
          </div>

          <div
            className={`nav-item${activePage === "activity-log" ? " active" : ""}`}
            onClick={() => handleNav("activity-log")}
          >
            <span className="ni">
              <i className="fa-solid fa-clock-rotate-left" />
            </span>
            <span className="nl">Activity Log</span>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="user-row">
            <div className="user-row-left">
              <div className="user-avatar">A</div>
              <div className="user-meta">
                <div className="user-name">Administrator</div>
                <div className="user-role">Super Admin</div>
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
                <span>Admin</span>
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
                <div className="section-subtitle">Welcome back, Administrator</div>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card blue">
                <div className="stat-icon blue">
                  <i className="fa-solid fa-layer-group" />
                </div>
                <div className="stat-body">
                  <div className="stat-value">{envLoaded ? stats.total : "—"}</div>
                  <div className="stat-label">Total Environments</div>
                </div>
              </div>
              <div className="stat-card green">
                <div className="stat-icon green">
                  <i className="fa-solid fa-circle-check" />
                </div>
                <div className="stat-body">
                  <div className="stat-value">{envLoaded ? stats.active : "—"}</div>
                  <div className="stat-label">Active</div>
                </div>
              </div>
              <div className="stat-card red">
                <div className="stat-icon red">
                  <i className="fa-solid fa-circle-xmark" />
                </div>
                <div className="stat-body">
                  <div className="stat-value">{envLoaded ? stats.inactive : "—"}</div>
                  <div className="stat-label">Inactive</div>
                </div>
              </div>
              <div className="stat-card yellow">
                <div className="stat-icon yellow">
                  <i className="fa-solid fa-key" />
                </div>
                <div className="stat-body">
                  <div className="stat-value">{envLoaded ? stats.withApi : "—"}</div>
                  <div className="stat-label">With API Keys</div>
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
              <div id="recentEnvsBody" ref={recentEnvsRef}>
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
                            <div className="env-name-cell">
                              <strong>{env.environment_name}</strong>
                              <div className="action-cell env-id-row">
                                <code style={{ fontSize: 11, color: "var(--text-muted)" }}>{env.id}</code>
                                <button className="icon-btn copy-id-btn" data-id={env.id} title="Copy ID">
                                  <i className="fa-solid fa-copy" />
                                </button>
                              </div>
                            </div>
                          </td>
                          <td dangerouslySetInnerHTML={{ __html: mask(env.client_id) }} />
                          <td>{formatLocalDate(env.created_at)}</td>
                          <td dangerouslySetInnerHTML={{ __html: badgeHtml(env.is_active) }} />
                          <td>
                            <div className="action-cell">
                              <button
                                className="icon-btn access-btn"
                                data-id={env.id}
                                data-name={env.environment_name}
                                title="API access scope"
                              >
                                <i className="fa-solid fa-shield-halved" />
                              </button>
                              <button className="icon-btn edit-btn" data-id={env.id} title="Edit environment">
                                <i className="fa-solid fa-pen-to-square" />
                              </button>
                              <button className="icon-btn dup-btn" data-id={env.id} title="Duplicate environment">
                                <i className="fa-regular fa-clone" />
                              </button>
                            </div>
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
                <div className="section-subtitle">Manage Wrike API credentials per environment</div>
              </div>
              <button className="btn btn-primary" onClick={openAddModal}>
                <i className="fa-solid fa-plus" />
                Add Environment
              </button>
            </div>

            <div className="card">
              <div className="card-body">
                <div id="alertContainer" />
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="table-wrapper" ref={envTableContainerRef} />
                </div>
              </div>
            </div>
          </div>

          {/* ══════ USERS PAGE ══════ */}
          <div className={`page${activePage === "users" ? " active" : ""}`} id="page-users">
            <div className="section-header">
              <div>
                <div className="section-title">Portal Users</div>
                <div className="section-subtitle">Manage portal user accounts and environment access</div>
              </div>
              <button className="btn btn-primary" onClick={openAddUserModal}>
                <i className="fa-solid fa-plus" /> Add User
              </button>
            </div>
            <div className="card">
              <div className="card-body">
                <div id="alertContainer" />
                <div style={{ overflowX: "auto" }}>
                  <div className="table-wrapper" ref={puTableContainerRef} />
                </div>
              </div>
            </div>
          </div>

          {/* ══════ SETTINGS PAGE ══════ */}
          <div className={`page${activePage === "settings" ? " active" : ""}`} id="page-settings">
            <div className="section-header">
              <div>
                <div className="section-title">Settings</div>
                <div className="section-subtitle">Configure system preferences</div>
              </div>
            </div>

            <div className="card">
              <div className="coming-soon">
                <div className="coming-soon-icon">
                  <i className="fa-solid fa-sliders" />
                </div>
                <h2>Settings</h2>
                <p>General system settings will be available here.</p>
              </div>
            </div>
          </div>

          {/* ══════ CACHE SETTINGS PAGE ══════ */}
          <div className={`page${activePage === "cache-settings" ? " active" : ""}`} id="page-cache-settings">
            <div className="section-header">
              <div>
                <div className="section-title">Cache Settings</div>
                <div className="section-subtitle">Manage cache keys and inspect Redis data</div>
              </div>
              <button
                className="btn btn-danger"
                disabled={cacheAllCount === 0 || cacheBulkDeleting}
                onClick={handleCacheBulkDelete}
              >
                <i className="fa-solid fa-trash" /> {bulkDeleteLabel}
              </button>
            </div>

            <div className="card">
              <div className="card-body">
                <div className="table-wrapper" style={{ marginTop: 0 }} ref={cacheTableContainerRef} />
              </div>
            </div>
          </div>

          {/* ══════ ACTIVITY LOG PAGE ══════ */}
          <div className={`page${activePage === "activity-log" ? " active" : ""}`} id="page-activity-log">
            <ActivityLog environments={environments} active={activePage === "activity-log"} />
          </div>
        </div>
      </div>

      {/* ═══════════ ENVIRONMENT API ACCESS DRAWER ═══════════ */}
      <EnvironmentAccess
        envId={accessDrawerEnvId}
        envName={accessDrawerEnvName}
        environment={environments.find((e) => e.id === accessDrawerEnvId) || null}
        open={accessDrawerOpen}
        onClose={() => setAccessDrawerOpen(false)}
        onChanged={loadEnvironments}
      />

      {/* ═══════════ PU: PERMISSIONS MODAL ═══════════ */}
      <PortalUserPermissions
        userId={permsUserId}
        username={permsUsername}
        open={permsOpen}
        onClose={() => setPermsOpen(false)}
      />

      {/* ═══════════ PU: ADD USER MODAL ═══════════ */}
      <div className={`modal-backdrop${puAddModalOpen ? " open" : ""}`}>
        <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>
          <div className="modal-header">
            <div className="modal-title">
              <i className="fa-solid fa-user-plus" /> Add Portal User
            </div>
            <button className="modal-close" onClick={() => setPuAddModalOpen(false)}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
          <div className="modal-body">
            <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "10px 12px",
                  marginBottom: 16,
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <i
                    className="fa-solid fa-wand-magic-sparkles"
                    style={{ color: "var(--accent)", fontSize: 13, flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                    Auto-fill username &amp; password with secure generated values.
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ flexShrink: 0, padding: "5px 12px", fontSize: 12 }}
                  onClick={handleGenerateCreds}
                >
                  <i className={`fa-solid ${puGenLoading ? "fa-spinner fa-spin" : "fa-wand-magic-sparkles"}`} />
                  Auto Fill
                </button>
              </div>
              <div className="form-group">
                <label className="form-label">
                  Username <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  className="form-control"
                  type="text"
                  placeholder="e.g. john.doe"
                  autoComplete="off"
                  required
                  value={puUsername}
                  onChange={(e) => setPuUsername(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  className="form-control"
                  type="text"
                  placeholder="Full name"
                  value={puFullName}
                  onChange={(e) => setPuFullName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  className="form-control"
                  type="email"
                  placeholder="user@example.com"
                  value={puEmail}
                  onChange={(e) => setPuEmail(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">
                  Password <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    className="form-control"
                    type={puPasswordVisible ? "text" : "password"}
                    placeholder="Password"
                    autoComplete="new-password"
                    minLength={10}
                    maxLength={16}
                    style={{ paddingRight: 38 }}
                    required
                    value={puPassword}
                    onChange={(e) => setPuPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setPuPasswordVisible((v) => !v)}
                    style={{
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: 13,
                    }}
                    tabIndex={-1}
                  >
                    <i className={`fa-solid ${puPasswordVisible ? "fa-eye-slash" : "fa-eye"}`} />
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                  <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    <i className="fa-solid fa-circle-info" /> User will be required to change this on first login.
                  </span>
                </div>
              </div>
            </form>
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setPuAddModalOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={puSaving} onClick={handleSaveUser}>
              <i className="fa-solid fa-floppy-disk" /> Save User
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════ PU: GENERATE CREDENTIALS MODAL (inert — see comment above) ═══════════ */}
      <div className={`modal-backdrop${puGenCredsModalOpen ? " open show" : ""}`}>
        <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 400 }}>
          <div className="modal-header">
            <div className="modal-title">
              <i className="fa-solid fa-wand-magic-sparkles" /> Generated Credentials
            </div>
            <button className="modal-close" onClick={() => setPuGenCredsModalOpen(false)}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
          <div className="modal-body">
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
              Share these credentials securely. The password will not be shown again.
            </p>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input className="form-control" type="text" readOnly onClick={(e) => (e.target as HTMLInputElement).select()} />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-control" type="text" readOnly onClick={(e) => (e.target as HTMLInputElement).select()} />
            </div>
            <div
              style={{
                background: "rgba(245, 158, 11, 0.1)",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                borderRadius: 6,
                padding: "10px 12px",
                fontSize: 12.5,
                color: "#92400e",
                marginTop: 4,
              }}
            >
              <i className="fa-solid fa-triangle-exclamation" /> Store this password safely. It cannot be recovered.
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setPuGenCredsModalOpen(false)}>
              Close
            </button>
            <button className="btn btn-primary">
              <i className="fa-solid fa-user-plus" /> Use to Create User
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════ PU: RESET PASSWORD MODAL ═══════════ */}
      <div className={`modal-backdrop${puResetModalOpen ? " open" : ""}`}>
        <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 380 }}>
          <div className="modal-header">
            <div className="modal-title">
              <i className="fa-solid fa-key" /> Reset Password
            </div>
            <button className="modal-close" onClick={() => setPuResetModalOpen(false)}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
          <div className="modal-body">
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
              Set a new password for <strong>{puResetUsername}</strong>. The user must change it on next login.
            </p>
            <div className="form-group">
              <label className="form-label">
                New Password <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <div style={{ position: "relative" }}>
                <input
                  className="form-control"
                  type={puResetPwdVisible ? "text" : "password"}
                  placeholder="Minimum 8 characters"
                  style={{ paddingRight: 38 }}
                  value={puResetPwdInput}
                  onChange={(e) => setPuResetPwdInput(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setPuResetPwdVisible((v) => !v)}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: 13,
                  }}
                  tabIndex={-1}
                >
                  <i className={`fa-solid ${puResetPwdVisible ? "fa-eye-slash" : "fa-eye"}`} />
                </button>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setPuResetModalOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={puResetSaving} onClick={handleConfirmReset}>
              <i className="fa-solid fa-key" /> Reset
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════ PU: EDIT USER MODAL ═══════════ */}
      <div className={`modal-backdrop${puEditModalOpen ? " open" : ""}`}>
        <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>
          <div className="modal-header">
            <div className="modal-title">
              <i className="fa-solid fa-user-pen" /> Edit User: <span style={{ fontWeight: 500 }}>{puEditUsernameDisplay}</span>
            </div>
            <button className="modal-close" onClick={() => setPuEditModalOpen(false)}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
          <div className="modal-body">
            <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
              <div className="form-group">
                <label className="form-label">Username</label>
                <div style={{ position: "relative" }}>
                  <input
                    className="form-control"
                    type="text"
                    placeholder="Username"
                    autoComplete="off"
                    style={{ paddingRight: 38 }}
                    value={puEditUsernameInput}
                    onChange={(e) => setPuEditUsernameInput(e.target.value)}
                  />
                  <button
                    type="button"
                    title="Generate username"
                    tabIndex={-1}
                    onClick={handleEditGenUsername}
                    style={{
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: 13,
                    }}
                  >
                    <i className={`fa-solid fa-wand-magic-sparkles${puEditGenLoading ? " fa-spin" : ""}`} />
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  className="form-control"
                  type="text"
                  placeholder="Full name"
                  value={puEditFullName}
                  onChange={(e) => setPuEditFullName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  className="form-control"
                  type="email"
                  placeholder="user@example.com"
                  value={puEditEmail}
                  onChange={(e) => setPuEditEmail(e.target.value)}
                />
              </div>
            </form>
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setPuEditModalOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={puEditSaving} onClick={handleSaveEditUser}>
              <i className="fa-solid fa-floppy-disk" /> Save Changes
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════ PU: ASSIGN ENVIRONMENTS MODAL ═══════════ */}
      <div className={`modal-backdrop${puAssignModalOpen ? " open" : ""}`}>
        <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 480 }}>
          <div className="modal-header">
            <div className="modal-title">
              <i className="fa-solid fa-plug" /> Manage Environments: <span style={{ fontWeight: 500 }}>{puAssignUsername}</span>
            </div>
            <button className="modal-close" onClick={() => setPuAssignModalOpen(false)}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
          <div className="modal-body" style={{ paddingBottom: 8 }}>
            <div className="form-section-label">
              <i className="fa-solid fa-link" /> Assigned Environments
            </div>
            <div style={{ minHeight: 40, marginBottom: 18 }}>
              {puAssignLoadError ? (
                <div style={{ color: "var(--danger)", fontSize: 13 }}>Failed to load environments.</div>
              ) : puAssignedEnvs === null ? (
                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</div>
              ) : puAssignedEnvs.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "8px 0" }}>
                  <i className="fa-solid fa-circle-info" style={{ marginRight: 5 }} /> No environments assigned yet.
                </div>
              ) : (
                puAssignedEnvs.map((env) => (
                  <div
                    key={env.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "9px 12px",
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      <i className="fa-solid fa-circle-dot" style={{ color: "var(--success)", marginRight: 7, fontSize: 9 }} />
                      {env.environment_name}
                    </span>
                    <button
                      className="btn btn-ghost"
                      style={{ height: 26, padding: "0 10px", fontSize: 12, color: "var(--danger)", borderColor: "rgba(239,68,68,0.3)" }}
                      onClick={() => puAssignId && puRevokeEnv(puAssignId, env.id)}
                    >
                      <i className="fa-solid fa-link-slash" /> Revoke
                    </button>
                  </div>
                ))
              )}
            </div>

            <div>
              <div className="form-section-label">
                <i className="fa-solid fa-plus-circle" /> Assign New Environment
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  className="form-control"
                  style={{ flex: 1, display: puUnassignedEnvs.length ? "" : "none" }}
                  value={puAssignSelectValue}
                  onChange={(e) => setPuAssignSelectValue(e.target.value)}
                >
                  <option value="">Select environment…</option>
                  {puUnassignedEnvs.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.environment_name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-primary"
                  style={{ height: 38, padding: "0 14px", flexShrink: 0 }}
                  disabled={!puUnassignedEnvs.length || puAssignAdding}
                  onClick={handleAddEnvToUser}
                >
                  <i className="fa-solid fa-link" /> Assign
                </button>
              </div>
              {!puUnassignedEnvs.length && (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "8px 0" }}>
                  <i className="fa-solid fa-circle-info" /> No unassigned environments available.
                </div>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setPuAssignModalOpen(false)}>
              Done
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════ REDIRECT URL SUCCESS MODAL ═══════════ */}
      <div className={`modal-backdrop${redirectModalOpen ? " show" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 480 }}>
          <div className="modal-header">
            <div className="modal-title">
              <i className="fa-solid fa-link" style={{ color: "var(--success)" }} />
              <span>Environment Created Successfully</span>
            </div>
            <button className="modal-close" aria-label="Close" onClick={closeRedirectUrlModal}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>

          <div className="modal-body">
            <div style={{ marginBottom: 16 }}>
              <p style={{ color: "var(--text-secondary)", marginBottom: 8, fontSize: 13 }}>Redirect URL (for Wrike OAuth):</p>
              <div className="redirect-url-box" style={{ position: "relative" }}>
                <div className="redirect-url-text" style={{ marginRight: 36 }}>
                  {redirectModalUrls.redirectUrl}
                </div>
                <CopyIconButton id="copySuccessUrlIcon" title="Copy URL" getText={() => redirectModalUrls.redirectUrl} />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <p style={{ color: "var(--text-secondary)", marginBottom: 8, fontSize: 13 }}>Login URL (with environment):</p>
              <div className="redirect-url-box" style={{ position: "relative" }}>
                <div className="redirect-url-text" style={{ marginRight: 36 }}>
                  {redirectModalUrls.loginUrl}
                </div>
                <CopyIconButton id="copySuccessLoginUrlIcon" title="Copy URL" getText={() => redirectModalUrls.loginUrl} />
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

      {/* ═══════════ ENVIRONMENT ADD/EDIT/DUPLICATE MODAL ═══════════ */}
      <div className={`modal-backdrop${envModalOpen ? " show" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">
              <i className="fa-solid fa-layer-group" />
              <span>{modalTitle}</span>
            </div>
            <button className="modal-close" aria-label="Close" onClick={closeEnvModal}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>

          <div className="modal-body" style={{ paddingBottom: 0 }}>
            <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
              <div className="form-group">
                <label className="form-label" htmlFor="envName">
                  Environment Name <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  ref={envNameInputRef}
                  className="form-control"
                  type="text"
                  id="envName"
                  placeholder="e.g. Production, Staging, Development"
                  required
                  value={envForm.environment_name}
                  onChange={(e) => setEnvForm((f) => ({ ...f, environment_name: e.target.value }))}
                />
              </div>

              <div className="form-section-label">Credentials</div>

              <div className="form-group">
                <label className="form-label" htmlFor="clientId">
                  Client ID <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  ref={clientIdInputRef}
                  className="form-control"
                  type="text"
                  id="clientId"
                  placeholder="Enter Client ID"
                  required
                  value={envForm.client_id}
                  onChange={(e) => setEnvForm((f) => ({ ...f, client_id: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="clientSecret">
                  Client Secret <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  className="form-control"
                  type="password"
                  id="clientSecret"
                  placeholder="Enter Client Secret"
                  required
                  value={envForm.client_secret}
                  onChange={(e) => setEnvForm((f) => ({ ...f, client_secret: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="accountId">
                  Account ID
                </label>
                <input
                  className="form-control"
                  type="text"
                  id="accountId"
                  placeholder="Enter Wrike Account ID"
                  value={envForm.account_id}
                  onChange={(e) => setEnvForm((f) => ({ ...f, account_id: e.target.value }))}
                />
              </div>

              <div className="form-section-label">Datahub IDs</div>

              <div className="form-group">
                <label className="form-label" htmlFor="xpiApiModulesDatahubId">
                  XPI API Modules Datahub ID <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  className="form-control"
                  type="text"
                  id="xpiApiModulesDatahubId"
                  placeholder="Enter XPI API Modules Datahub ID"
                  required
                  value={envForm.xpi_api_modules_datahub_id}
                  onChange={(e) => setEnvForm((f) => ({ ...f, xpi_api_modules_datahub_id: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="xpiApiServicesDatahubId">
                  XPI API Services Datahub ID <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  className="form-control"
                  type="text"
                  id="xpiApiServicesDatahubId"
                  placeholder="Enter XPI API Services Datahub ID"
                  required
                  value={envForm.xpi_api_services_datahub_id}
                  onChange={(e) => setEnvForm((f) => ({ ...f, xpi_api_services_datahub_id: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="xpiEntityDatahubId">
                  XPI Entity Datahub ID <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  className="form-control"
                  type="text"
                  id="xpiEntityDatahubId"
                  placeholder="Enter XPI Entity Datahub ID"
                  required
                  value={envForm.xpi_entity_datahub_id}
                  onChange={(e) => setEnvForm((f) => ({ ...f, xpi_entity_datahub_id: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="xpiFieldMappingDatahubId">
                  XPI Field Mapping Datahub ID <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  className="form-control"
                  type="text"
                  id="xpiFieldMappingDatahubId"
                  placeholder="Enter XPI Field Mapping Datahub ID"
                  required
                  value={envForm.xpi_field_mapping_datahub_id}
                  onChange={(e) => setEnvForm((f) => ({ ...f, xpi_field_mapping_datahub_id: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="xpiRequestFormFieldMappingDatahubId">
                  XPI Request Form Field Mapping Datahub ID <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  className="form-control"
                  type="text"
                  id="xpiRequestFormFieldMappingDatahubId"
                  placeholder="Enter XPI Request Form Field Mapping Datahub ID"
                  required
                  value={envForm.xpi_request_form_field_mapping_datahub_id}
                  onChange={(e) =>
                    setEnvForm((f) => ({ ...f, xpi_request_form_field_mapping_datahub_id: e.target.value }))
                  }
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="xpiRequestFormMappingDatahubId">
                  XPI Request Form Mapping Datahub ID <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  className="form-control"
                  type="text"
                  id="xpiRequestFormMappingDatahubId"
                  placeholder="Enter XPI Request Form Mapping Datahub ID"
                  required
                  value={envForm.xpi_request_form_mapping_datahub_id}
                  onChange={(e) => setEnvForm((f) => ({ ...f, xpi_request_form_mapping_datahub_id: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="xpiSpaceNameDatahubId">
                  XPI Space Name Datahub ID <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  className="form-control"
                  type="text"
                  id="xpiSpaceNameDatahubId"
                  placeholder="Enter XPI Space Name Datahub ID"
                  required
                  value={envForm.xpi_space_name_datahub_id}
                  onChange={(e) => setEnvForm((f) => ({ ...f, xpi_space_name_datahub_id: e.target.value }))}
                />
              </div>

              <div className="form-section-label">Space IDs</div>

              <div className="form-group">
                <label className="form-label" htmlFor="campaignSpaceId">
                  Campaign Space ID <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  className="form-control"
                  type="text"
                  id="campaignSpaceId"
                  placeholder="Enter Campaign Space ID"
                  required
                  value={envForm.campaign_space_id}
                  onChange={(e) => setEnvForm((f) => ({ ...f, campaign_space_id: e.target.value }))}
                />
              </div>

              <hr className="form-divider" />

              <div className="toggle-row">
                <div className="toggle-row-info">
                  <div className="toggle-row-label">Visibility</div>
                  <div className="toggle-row-desc">Show or hide this environment in dropdowns</div>
                </div>
                <label className="toggle-wrap">
                  <input
                    type="checkbox"
                    checked={envForm.is_visible}
                    onChange={(e) => setEnvForm((f) => ({ ...f, is_visible: e.target.checked }))}
                  />
                  <div className="toggle-track" />
                </label>
              </div>

              <hr className="form-divider" />

              <div className="toggle-row">
                <div className="toggle-row-info">
                  <div className="toggle-row-label">Active Status</div>
                  <div className="toggle-row-desc">Enable or disable this environment</div>
                </div>
                <label className="toggle-wrap">
                  <input
                    type="checkbox"
                    checked={envForm.is_active}
                    onChange={(e) => setEnvForm((f) => ({ ...f, is_active: e.target.checked }))}
                  />
                  <div className="toggle-track" />
                </label>
              </div>

              <hr className="form-divider" />

              {envModalMode === "edit" && (
                <div>
                  <div className="form-row-label">URLs</div>
                  <div>
                    <p style={{ color: "var(--text-secondary)", marginBottom: 6, fontSize: 12 }}>Redirect URL:</p>
                    {showRedirectSectionInModal ? (
                      <div className="redirect-url-box">
                        <div className="redirect-url-text">{wrikeRedirectUrl}</div>
                        <CopyIconButton id="copyRedirectUrlIcon" title="Copy URL" getText={() => wrikeRedirectUrl} />
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
                        <em>Save the environment first to generate the redirect URL</em>
                      </div>
                    )}
                  </div>

                  {showRedirectSectionInModal && (
                    <div style={{ marginTop: 12 }}>
                      <p style={{ color: "var(--text-secondary)", marginBottom: 6, fontSize: 12 }}>Login URL:</p>
                      <div className="redirect-url-box">
                        <div className="redirect-url-text">{editModalLoginUrl}</div>
                        <CopyIconButton id="copyLoginUrlIcon" title="Copy URL" getText={() => editModalLoginUrl} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </form>
          </div>

          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={closeEnvModal}>
              Cancel
            </button>
            <button className={`btn btn-primary${envSaving ? " loading" : ""}`} disabled={envSaving} onClick={handleSaveEnvironment}>
              <i className="fa-solid fa-floppy-disk" />
              Save
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════ CACHE DETAIL MODAL ═══════════ */}
      <div className={`modal-backdrop${cacheDetailModalOpen ? " open" : ""}`}>
        <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 760 }}>
          <div className="modal-header">
            <div className="modal-title">
              <i className="fa-solid fa-database" />
              <span>Cache Key Details</span>
            </div>
            <button className="modal-close" aria-label="Close" onClick={closeCacheDetailModal}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
          <div className="modal-body">
            <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
              <div>
                <strong>Key:</strong> <span>{cacheDetailKey || "—"}</span>
              </div>
              <div>
                <strong>Type:</strong> <span>{cacheDetailType || "—"}</span>
                <span style={{ marginLeft: 12 }}>
                  <strong>TTL:</strong> <span>{cacheDetailTtl || "—"}</span>
                </span>
              </div>
            </div>
            <div className="cache-value">{cacheDetailValue}</div>
          </div>
          <div className="modal-footer" style={{ justifyContent: "space-between" }}>
            <button className="btn btn-danger" onClick={handleCacheDetailDelete}>
              <i className="fa-solid fa-trash" /> Delete This Key
            </button>
            <button className="btn btn-ghost" onClick={closeCacheDetailModal}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
