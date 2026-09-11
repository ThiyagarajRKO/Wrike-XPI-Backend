import { CacheTable } from "../components/CacheTable";
import { useCallback, useEffect, useRef, useState } from "react";
import { adminLogout, clearAdminSession, getAccessToken } from "../lib/authApi";
import { fetchAppConfig, DEFAULT_CONFIG, type AppConfig } from "../lib/appConfig";
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
import MfaSettings from "./MfaSettings";
import { EnvironmentsTable } from "./admin/EnvironmentsTable";
import { PortalUsersTable } from "./admin/PortalUsersTable";
import EnvBadge from "../components/EnvBadge";
import BuildTag from "../components/BuildTag";
import { CopyButton } from "../components/ui/CopyButton";
import { ActiveBadge } from "../components/ui/Badge";
import { MaskedValue } from "../components/ui/MaskedValue";
import { copyToClipboard, formatDateTime } from "../lib/format";
import { escHtml, toast } from "../lib/notify";
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
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

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

  const [refreshing, setRefreshing] = useState(false);
  // Bumped every time the top-bar Refresh is hit while the Activity Log page
  // is open; passed to <ActivityLog> so it re-fetches rows + summary.
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);

  /* ── Environments ─────────────────────────────────────────────────── */
  const [environments, setEnvironments] = useState<AdminEnvironment[]>([]);
  const [envLoaded, setEnvLoaded] = useState(false);

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

  /* Flips one switch (Visibility or Status) from the Environments list.
   *
   * No list re-fetch: only this environment's field changed, so patching it
   * into state keeps the rest of the dashboard (stats, recent list, edit
   * modal) consistent without a round trip. <Toggle /> owns the in-flight
   * spinner and reverts itself if this rejects, so the error is re-thrown
   * rather than swallowed. */
  const handleEnvToggle = useCallback(
    async (env: AdminEnvironment, field: "is_active" | "is_visible", next: boolean) => {
      try {
        await toggleEnvironmentStatus(env.id, { [field]: next });
        setEnvironments((prev) =>
          prev.map((row) => (row.id === env.id ? { ...row, [field]: next } : row)),
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
        toast(err?.message || "Update failed", "error");
        throw err;
      }
    },
    [],
  );

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
  // Mirrors envLoaded: the table shows its loading skeleton until the first
  // fetch resolves, so it never flashes the "no portal users" empty state.
  const [puLoaded, setPuLoaded] = useState(false);

  // Module-permission modal — opened from a user row's shield-icon button.
  const [permsUserId, setPermsUserId] = useState<string | null>(null);
  const [permsUsername, setPermsUsername] = useState<string | null>(null);
  const [permsOpen, setPermsOpen] = useState(false);

  function openPortalUserPermissions(userId: string, username: string) {
    setPermsUserId(userId);
    setPermsUsername(username);
    setPermsOpen(true);
  }

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
  // Read by callbacks that must not re-create themselves on every keystroke
  // (handleRefresh, the post-delete reload).
  const cacheSearchPatternRef = useRef(cacheSearchPattern);
  cacheSearchPatternRef.current = cacheSearchPattern;

  const loadCacheEntries = async (patternOverride?: string) => {
    const normalizedPattern =
      typeof patternOverride === "string" ? patternOverride.trim() : cacheSearchPatternRef.current;

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

  /* Stable identity so <CacheTable />'s debounce effect isn't torn down and
     rebuilt on every parent render, which would restart the timer and mean
     the query never fires while the user keeps typing. */
  const handleCacheSearch = useCallback((pattern: string) => {
    loadCacheEntries(pattern);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    let refreshPromise;
    if (activePage === "cache-settings") {
      refreshPromise = loadCacheEntries(cacheSearchPatternRef.current);
    } else if (activePage === "users") {
      refreshPromise = loadPortalUsers();
    } else if (activePage === "activity-log") {
      // The Activity Log owns its own fetch (rows + summary) — bump its key
      // and let the child reload the current page.
      setActivityRefreshKey((k) => k + 1);
      refreshPromise = Promise.resolve();
    } else {
      refreshPromise = loadEnvironments();
    }

    Promise.resolve(refreshPromise).finally(() =>
      setTimeout(() => setRefreshing(false), 600),
    );
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
              <span className="brand">
                Xtend Backend
                <BuildTag />
              </span>
              <span
                className="sub"
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                Admin Portal
                {!collapsed && <EnvBadge />}
              </span>
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
            className={`nav-item${activePage === "settings" ? " active" : ""}`}
            onClick={() => handleNav("settings")}
          >
            <span className="ni">
              <i className="fa-solid fa-shield-halved" />
            </span>
            <span className="nl">Security</span>
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
                                <code className="env-id-code">{env.id}</code>
                                <CopyButton value={env.id} title="Copy ID" />
                              </div>
                            </div>
                          </td>
                          <td>
                            <MaskedValue value={env.client_id} />
                          </td>
                          <td>{formatDateTime(env.created_at)}</td>
                          <td>
                            <ActiveBadge active={env.is_active} />
                          </td>
                          <td>
                            <div className="action-cell">
                              <button
                                type="button"
                                className="icon-btn"
                                title="API access scope"
                                onClick={() => openAccessDrawer(env.id, env.environment_name)}
                              >
                                <i className="fa-solid fa-shield-halved" />
                              </button>
                              <button
                                type="button"
                                className="icon-btn"
                                title="Edit environment"
                                onClick={() => openEditModal(env.id)}
                              >
                                <i className="fa-solid fa-pen-to-square" />
                              </button>
                              <button
                                type="button"
                                className="icon-btn"
                                title="Duplicate environment"
                                onClick={() => openDuplicateModal(env.id)}
                              >
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
                <EnvironmentsTable
                  environments={environments}
                  loading={!envLoaded}
                  onAdd={openAddModal}
                  onEdit={(env) => openEditModal(env.id)}
                  onDuplicate={(env) => openDuplicateModal(env.id)}
                  onDelete={(env) => confirmDeleteEnvironment(env.id, env.environment_name)}
                  onOpenAccess={(env) => openAccessDrawer(env.id, env.environment_name)}
                  onToggle={handleEnvToggle}
                />
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
                <PortalUsersTable
                  users={puUsers}
                  loading={!puLoaded}
                  onAdd={openAddUserModal}
                  onPermissions={(user) => openPortalUserPermissions(user.id, user.username)}
                  onEdit={(user) => puOpenEdit(user.id)}
                  onResetPassword={(user) => puOpenReset(user.id, user.username)}
                  onMapEnvironment={(user) => puOpenAssignEnv(user.id, user.username)}
                  onToggleStatus={(user, nextActive) => puToggleStatus(user.id, nextActive)}
                />
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
              <MfaSettings />
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
                <CacheTable
                  entries={cacheEntries}
                  loading={false}
                  selectedKeys={selectedCacheKeys}
                  onSelectionChange={setSelectedCacheKeys}
                  onView={openCacheDetailModal}
                  onDelete={(key) => {
                    deleteCacheKeyWithConfirm(key).catch((err: any) =>
                      toast(err?.message || "Failed to delete cache key", "error"),
                    );
                  }}
                  onSearch={handleCacheSearch}
                />
              </div>
            </div>
          </div>

          {/* ══════ ACTIVITY LOG PAGE ══════ */}
          <div className={`page${activePage === "activity-log" ? " active" : ""}`} id="page-activity-log">
            <ActivityLog
              environments={environments}
              active={activePage === "activity-log"}
              refreshKey={activityRefreshKey}
            />
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

      {/* ═══════════ PU: MAP ENVIRONMENT MODAL ═══════════ */}
      <div className={`modal-backdrop${puAssignModalOpen ? " open" : ""}`}>
        <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 500 }}>
          <div className="modal-header">
            <div className="modal-title">
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                  fontSize: 14,
                  flex: "none",
                }}
              >
                <i className="fa-solid fa-diagram-project" />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span>Map Environment</span>
                <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--text-muted)" }}>
                  <i className="fa-solid fa-user" style={{ marginRight: 5 }} />
                  {puAssignUsername}
                </span>
              </span>
            </div>
            <button className="modal-close" onClick={() => setPuAssignModalOpen(false)} aria-label="Close">
              <i className="fa-solid fa-xmark" />
            </button>
          </div>

          <div className="modal-body" style={{ paddingBottom: 8 }}>
            {/* Mapped environments */}
            <div className="form-section-label no-rule" style={{ marginBottom: 10 }}>
              <i className="fa-solid fa-link" /> Mapped environments
              <span
                style={{
                  marginLeft: 8,
                  background: "var(--bg-surface-2)",
                  color: "var(--text-secondary)",
                  borderRadius: 999,
                  padding: "1px 8px",
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: "18px",
                }}
              >
                {puAssignedEnvs === null ? "…" : puAssignedEnvs.length}
              </span>
            </div>

            {puAssignLoadError ? (
              <div
                style={{
                  padding: "12px 14px",
                  background: "var(--danger-soft)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--danger)",
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 6 }} />
                Failed to load mapped environments. Please try again.
              </div>
            ) : puAssignedEnvs === null ? (
              <div
                style={{
                  padding: "14px 0",
                  color: "var(--text-muted)",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                <i className="fa-solid fa-spinner fa-spin" /> Loading mapped environments…
              </div>
            ) : puAssignedEnvs.length === 0 ? (
              <div
                style={{
                  padding: "18px 14px",
                  background: "var(--bg-surface)",
                  border: "1px dashed var(--border)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text-muted)",
                  fontSize: 13,
                  textAlign: "center",
                  marginBottom: 16,
                }}
              >
                <i
                  className="fa-regular fa-folder-open"
                  style={{ display: "block", fontSize: 18, marginBottom: 6, opacity: 0.5 }}
                />
                No environments mapped yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                {puAssignedEnvs.map((env) => (
                  <div
                    key={env.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "8px 10px 8px 12px",
                      background: "var(--bg-card)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 26,
                          height: 26,
                          borderRadius: "50%",
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                          fontSize: 11,
                          flex: "none",
                        }}
                      >
                        <i className="fa-solid fa-layer-group" />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "var(--text-primary)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {env.environment_name}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                          {env.account_id ? env.account_id : "No Wrike account"}
                        </div>
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost"
                      style={{
                        height: 26,
                        padding: "0 10px",
                        fontSize: 12,
                        color: "var(--danger)",
                        borderColor: "rgba(239,68,68,0.3)",
                        flex: "none",
                      }}
                      onClick={() => puAssignId && puRevokeEnv(puAssignId, env.id)}
                    >
                      <i className="fa-solid fa-link-slash" /> Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Map another environment */}
            <div>
              <div className="form-section-label no-rule" style={{ marginBottom: 10 }}>
                <i className="fa-solid fa-plus-circle" /> Map another environment
              </div>

              <div className="info-banner">
                <i className="fa-solid fa-circle-info" />
                <span>Each environment can only be mapped to one user at a time.</span>
              </div>

              {puUnassignedEnvs.length ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <select
                    className="form-control"
                    style={{ flex: 1 }}
                    value={puAssignSelectValue}
                    onChange={(e) => setPuAssignSelectValue(e.target.value)}
                  >
                    <option value="">Select an environment…</option>
                    {puUnassignedEnvs.map((env) => (
                      <option key={env.id} value={env.id}>
                        {env.environment_name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary"
                    style={{ height: 38, padding: "0 14px", flexShrink: 0 }}
                    disabled={puAssignAdding || !puAssignSelectValue}
                    onClick={handleAddEnvToUser}
                  >
                    {puAssignAdding ? (
                      <i className="fa-solid fa-spinner fa-spin" />
                    ) : (
                      <i className="fa-solid fa-link" />
                    )}
                    Map
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    padding: "10px 12px",
                    background: "var(--bg-surface)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text-muted)",
                    fontSize: 12.5,
                  }}
                >
                  No unmapped environments left — every environment has a user.
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
