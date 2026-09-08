import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdminEnvironment } from "../lib/adminApi";
import {
  ACTION_NAMES,
  bulkCreateRules,
  createRule,
  deletePermission,
  deleteRule,
  getAccessConfig,
  grantColumn,
  grantedActions,
  listPermissions,
  listRules,
  simulateAccess,
  updatePermission,
  updateRule,
  upsertPermission,
  type AccessConfig,
  type AccessGate,
  type AccessRule,
  type ActionName,
  type Grant,
  type RuleType,
  type SimulationResult,
  type UserPermission,
} from "../lib/accessApi";
import { confirmDanger, escHtml, progress, toast } from "../lib/notify";
import "./AccessControl.css";

/* ── Vocabulary ────────────────────────────────────────────────────────
   One place that decides what each permission is *called* and what it
   actually lets someone do, so the table, the modals and the simulator can
   never describe the same grant three different ways. */

const ACTION_COPY: Record<ActionName, { label: string; blurb: string }> = {
  read: { label: "Read", blurb: "View campaigns, channels and tasks" },
  create: { label: "Create", blurb: "Add new campaigns and records" },
  update: { label: "Update", blurb: "Change existing records" },
  delete: { label: "Delete", blurb: "Permanently remove records" },
};

// Rows past this point render without an entrance delay — staggering a long
// table reads as slowness, not polish.
const STAGGER_LIMIT = 12;

type TabId = "allowlist" | "permissions" | "check";

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: "allowlist", label: "Allow list", icon: "fa-address-book" },
  { id: "permissions", label: "Permissions", icon: "fa-user-shield" },
  { id: "check", label: "Access check", icon: "fa-vial-circle-check" },
];

const EMPTY_GRANT: Grant = {
  can_read: true,
  can_create: false,
  can_update: false,
  can_delete: false,
};

interface Props {
  /** Every environment, used only to offer sources for "copy from". */
  environments: AdminEnvironment[];
  /** The environment this drawer governs. Never a picker — the admin already
      chose it by clicking a row, so re-asking would be a second decision for
      the same intent. */
  envId: string | null;
  open: boolean;
  onClose: () => void;
}

/* ── Shared presentational pieces ──────────────────────────────────────── */

function GrantPills({
  grant,
  onToggle,
  busy,
  disabled,
}: {
  grant: Grant;
  onToggle?: (action: ActionName, next: boolean) => void;
  busy?: ActionName | null;
  disabled?: boolean;
}) {
  const interactive = !!onToggle && !disabled;

  return (
    <div className="ac-grants">
      {ACTION_NAMES.map((action) => {
        const on = !!grant[grantColumn(action)];
        const label = ACTION_COPY[action].label;

        return (
          <button
            key={action}
            type="button"
            className={`ac-grant${interactive ? "" : " ac-grant-static"}${
              busy === action ? " ac-saving" : ""
            }`}
            aria-pressed={on}
            aria-label={`${label}: ${on ? "granted" : "not granted"}${
              interactive ? ". Click to change" : ""
            }`}
            title={ACTION_COPY[action].blurb}
            disabled={!interactive || busy === action}
            onClick={interactive ? () => onToggle!(action, !on) : undefined}
          >
            <i className="fa-solid fa-check" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function GrantPicker({
  grant,
  onChange,
}: {
  grant: Grant;
  onChange: (next: Grant) => void;
}) {
  return (
    <div className="ac-grant-picker">
      {ACTION_NAMES.map((action) => {
        const column = grantColumn(action);
        return (
          <label className="ac-grant-option" key={action}>
            <input
              type="checkbox"
              checked={!!grant[column]}
              onChange={(e) =>
                onChange({ ...grant, [column]: e.target.checked })
              }
            />
            <span>
              <span className="ac-grant-option-title">
                {ACTION_COPY[action].label}
              </span>
              <span className="ac-grant-option-desc">
                {ACTION_COPY[action].blurb}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function SkeletonRows({ columns, rows = 4 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr className="ac-skeleton-row" key={rowIndex}>
          {Array.from({ length: columns }).map((__, colIndex) => (
            <td key={colIndex}>
              <div
                className="ac-skeleton"
                style={{ width: colIndex === 0 ? "70%" : "45%" }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function EmptyState({
  icon,
  title,
  desc,
  action,
}: {
  icon: string;
  title: string;
  desc: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="ac-empty">
      <div className="ac-empty-icon">
        <i className={`fa-solid ${icon}`} aria-hidden="true" />
      </div>
      <div className="ac-empty-title">{title}</div>
      <div className="ac-empty-desc">{desc}</div>
      {action}
    </div>
  );
}

const GATE_ICONS: Record<AccessGate["status"], string> = {
  pass: "fa-check",
  fail: "fa-xmark",
  pending: "fa-clock",
  skipped: "fa-minus",
};

/* ── The screen ────────────────────────────────────────────────────────── */

export default function AccessControl({
  environments,
  envId: envIdProp,
  open,
  onClose,
}: Props) {
  // Narrowed once here so the rest of the component can treat it as a plain
  // string — the drawer never renders content without an environment anyway.
  const envId = envIdProp ?? "";

  const [config, setConfig] = useState<AccessConfig | null>(null);

  const [tab, setTab] = useState<TabId>("allowlist");

  const [rules, setRules] = useState<AccessRule[]>([]);
  const [permissions, setPermissions] = useState<UserPermission[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Which single pill is mid-save, so only that pill shows a pending state
  // instead of the whole row greying out.
  const [savingCell, setSavingCell] = useState<{
    id: string;
    action: ActionName;
  } | null>(null);

  const [ruleModal, setRuleModal] = useState<{
    open: boolean;
    editing: AccessRule | null;
    ruleType: RuleType;
    value: string;
    label: string;
    grant: Grant;
  }>({
    open: false,
    editing: null,
    ruleType: "email",
    value: "",
    label: "",
    grant: EMPTY_GRANT,
  });

  const [bulkModal, setBulkModal] = useState<{
    open: boolean;
    text: string;
    grant: Grant;
  }>({ open: false, text: "", grant: EMPTY_GRANT });

  const [userModal, setUserModal] = useState<{
    open: boolean;
    editing: UserPermission | null;
    email: string;
    displayName: string;
    grant: Grant;
  }>({
    open: false,
    editing: null,
    email: "",
    displayName: "",
    grant: EMPTY_GRANT,
  });

  const [saving, setSaving] = useState(false);

  const [simEmail, setSimEmail] = useState("");
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simBusy, setSimBusy] = useState(false);

  const loadedOnce = useRef(false);

  const selectedEnv = useMemo(
    () => environments.find((e) => e.id === envId) || null,
    [environments, envId],
  );

  /* ── Loading ────────────────────────────────────────────────────────── */

  const loadEnvironmentData = useCallback(
    async (id: string) => {
      if (!id) return;
      setLoading(true);
      try {
        const [ruleRows, permissionRows] = await Promise.all([
          listRules(id),
          listPermissions(id),
        ]);
        setRules(ruleRows);
        setPermissions(permissionRows);
      } catch (err: any) {
        toast(err?.message || "Failed to load access settings", "error");
        setRules([]);
        setPermissions([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Deferred until the drawer is first opened — the console keeps it mounted
  // so it can animate, and none of this is needed until someone looks at it.
  useEffect(() => {
    if (!open || loadedOnce.current) return;
    loadedOnce.current = true;

    getAccessConfig().then(setConfig).catch(() => {});
  }, [open]);

  // Each opening is a fresh question about one environment — start on the
  // first tab rather than wherever the previous environment was left.
  useEffect(() => {
    if (open) setTab("allowlist");
  }, [open, envId]);

  useEffect(() => {
    if (open && envId) loadEnvironmentData(envId);
  }, [open, envId, loadEnvironmentData]);

  // Esc closes, matching every other dismissible surface in the console.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    // A new environment is a different question — old answers shouldn't linger.
    setSimResult(null);
    setSearch("");
  }, [envId]);

  /* ── Derived ────────────────────────────────────────────────────────── */

  const filteredRules = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rules;
    return rules.filter(
      (r) =>
        r.value.includes(needle) ||
        (r.label || "").toLowerCase().includes(needle),
    );
  }, [rules, search]);

  const filteredPermissions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return permissions;
    return permissions.filter(
      (p) =>
        p.email.includes(needle) ||
        (p.display_name || "").toLowerCase().includes(needle),
    );
  }, [permissions, search]);

  const enabledRules = rules.filter((r) => r.is_enabled).length;
  const domainRules = rules.filter((r) => r.rule_type === "domain").length;
  const fieldName = config?.custom_field_name || "Xtend API";

  /* ── Mutations ──────────────────────────────────────────────────────── */

  const afterWrite = useCallback(async () => {
    await loadEnvironmentData(envId);
  }, [envId, loadEnvironmentData]);

  const toggleRuleGrant = async (
    rule: AccessRule,
    action: ActionName,
    next: boolean,
  ) => {
    setSavingCell({ id: rule.id, action });

    // Optimistic: the pill flips immediately and rolls back only if the write
    // actually fails. A permission toggle that waits on a round trip feels
    // broken even when it isn't.
    setRules((rows) =>
      rows.map((r) =>
        r.id === rule.id ? { ...r, [grantColumn(action)]: next } : r,
      ),
    );

    try {
      await updateRule(rule.id, { [grantColumn(action)]: next });
    } catch (err: any) {
      setRules((rows) =>
        rows.map((r) =>
          r.id === rule.id ? { ...r, [grantColumn(action)]: !next } : r,
        ),
      );
      toast(err?.message || "Could not update the entry", "error");
    } finally {
      setSavingCell(null);
    }
  };

  const toggleRuleEnabled = async (rule: AccessRule) => {
    const next = !rule.is_enabled;

    setRules((rows) =>
      rows.map((r) => (r.id === rule.id ? { ...r, is_enabled: next } : r)),
    );

    try {
      await updateRule(rule.id, { is_enabled: next });
      toast(
        next
          ? `${rule.value} can call the API again`
          : `${rule.value} is switched off`,
        next ? "success" : "warning",
      );
    } catch (err: any) {
      setRules((rows) =>
        rows.map((r) => (r.id === rule.id ? { ...r, is_enabled: !next } : r)),
      );
      toast(err?.message || "Could not change the switch", "error");
    }
  };

  const togglePermissionGrant = async (
    permission: UserPermission,
    action: ActionName,
    next: boolean,
  ) => {
    setSavingCell({ id: permission.id, action });

    setPermissions((rows) =>
      rows.map((p) =>
        p.id === permission.id ? { ...p, [grantColumn(action)]: next } : p,
      ),
    );

    try {
      await updatePermission(permission.id, { [grantColumn(action)]: next });
    } catch (err: any) {
      setPermissions((rows) =>
        rows.map((p) =>
          p.id === permission.id ? { ...p, [grantColumn(action)]: !next } : p,
        ),
      );
      toast(err?.message || "Could not update permissions", "error");
    } finally {
      setSavingCell(null);
    }
  };

  const submitRule = async () => {
    const value = ruleModal.value.trim().toLowerCase();
    if (!value) {
      toast("Enter an email address or domain", "warning");
      return;
    }

    setSaving(true);
    progress.start();
    try {
      if (ruleModal.editing) {
        await updateRule(ruleModal.editing.id, {
          value,
          label: ruleModal.label.trim() || null,
          ...ruleModal.grant,
        });
        toast("Allow-list entry updated", "success");
      } else {
        await createRule({
          env_id: envId,
          rule_type: ruleModal.ruleType,
          value,
          label: ruleModal.label.trim() || null,
          is_enabled: true,
          ...ruleModal.grant,
        });
        toast(`${value} added to the allow list`, "success");
      }

      setRuleModal((m) => ({ ...m, open: false }));
      await afterWrite();
    } catch (err: any) {
      toast(err?.message || "Could not save the entry", "error");
    } finally {
      setSaving(false);
      progress.done();
    }
  };

  const submitBulk = async () => {
    // Split on anything a pasted list realistically uses as a separator.
    const values = bulkModal.text
      .split(/[\s,;]+/)
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);

    if (!values.length) {
      toast("Paste at least one email address or domain", "warning");
      return;
    }

    const entries = values.map((value) => ({
      value: value.replace(/^@/, ""),
      // A bare "@domain.com" or a token with no "@" at all is a domain rule;
      // anything with a local part is an individual.
      rule_type: (value.startsWith("@") || !value.includes("@")
        ? "domain"
        : "email") as RuleType,
      ...bulkModal.grant,
    }));

    setSaving(true);
    progress.start();
    try {
      const result = await bulkCreateRules(envId, entries);
      toast(
        result.skipped.length
          ? `Added ${result.created}. ${result.skipped.length} were already on the list.`
          : `Added ${result.created} to the allow list`,
        "success",
      );
      setBulkModal({ open: false, text: "", grant: EMPTY_GRANT });
      await afterWrite();
    } catch (err: any) {
      toast(err?.message || "Could not add the entries", "error");
    } finally {
      setSaving(false);
      progress.done();
    }
  };

  const submitUser = async () => {
    const email = userModal.email.trim().toLowerCase();
    if (!email) {
      toast("Enter the user's Wrike email address", "warning");
      return;
    }

    setSaving(true);
    progress.start();
    try {
      await upsertPermission({
        env_id: envId,
        email,
        display_name: userModal.displayName.trim() || null,
        ...userModal.grant,
      });
      toast(`Access saved for ${email}`, "success");
      setUserModal((m) => ({ ...m, open: false }));
      await afterWrite();
    } catch (err: any) {
      toast(err?.message || "Could not save access", "error");
    } finally {
      setSaving(false);
      progress.done();
    }
  };

  const removeRule = async (rule: AccessRule) => {
    const ok = await confirmDanger({
      title: "Remove from allow list?",
      html:
        `<strong>${escHtml(rule.value)}</strong> will no longer be able to ` +
        `call the API in <strong>${escHtml(
          selectedEnv?.environment_name || "",
        )}</strong>.`,
      confirmText: "Remove",
    });
    if (!ok) return;

    progress.start();
    try {
      await deleteRule(rule.id);
      toast("Removed from the allow list", "success");
      await afterWrite();
    } catch (err: any) {
      toast(err?.message || "Could not remove the entry", "error");
    } finally {
      progress.done();
    }
  };

  const removePermission = async (permission: UserPermission) => {
    const ok = await confirmDanger({
      title: "Remove this user's permissions?",
      html:
        `<strong>${escHtml(permission.email)}</strong> will fall back to ` +
        `whatever their allow-list entry grants.`,
      confirmText: "Remove",
    });
    if (!ok) return;

    progress.start();
    try {
      await deletePermission(permission.id);
      toast("Per-user access removed", "success");
      await afterWrite();
    } catch (err: any) {
      toast(err?.message || "Could not remove access", "error");
    } finally {
      progress.done();
    }
  };

  const runSimulation = async () => {
    const email = simEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      toast("Enter a full email address to check", "warning");
      return;
    }

    setSimBusy(true);
    try {
      setSimResult(await simulateAccess(envId, email));
    } catch (err: any) {
      toast(err?.message || "Could not run the check", "error");
      setSimResult(null);
    } finally {
      setSimBusy(false);
    }
  };

  /* ── Render ─────────────────────────────────────────────────────────── */

  const openRuleModal = (rule: AccessRule | null, ruleType: RuleType = "email") =>
    setRuleModal({
      open: true,
      editing: rule,
      ruleType: rule?.rule_type || ruleType,
      value: rule?.value || "",
      label: rule?.label || "",
      grant: rule
        ? {
            can_read: rule.can_read,
            can_create: rule.can_create,
            can_update: rule.can_update,
            can_delete: rule.can_delete,
          }
        : EMPTY_GRANT,
    });

  const openUserModal = (permission: UserPermission | null) =>
    setUserModal({
      open: true,
      editing: permission,
      email: permission?.email || "",
      displayName: permission?.display_name || "",
      grant: permission
        ? {
            can_read: permission.can_read,
            can_create: permission.can_create,
            can_update: permission.can_update,
            can_delete: permission.can_delete,
          }
        : EMPTY_GRANT,
    });

  return (
    <div
      className={`ac-scrim${open ? " open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="ac-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="API access control"
      >
        <header className="ac-drawer-head">
          <div className="ac-drawer-title">
            <span className="ac-drawer-icon" aria-hidden="true">
              <i className="fa-solid fa-shield-halved" />
            </span>
            <div>
              <div className="ac-drawer-name">API Access</div>
              <div className="ac-drawer-env">
                {selectedEnv?.environment_name || "—"}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="ac-drawer-close"
            aria-label="Close"
            onClick={onClose}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </header>

        <div className="ac-drawer-body">

      {config && !config.enforced && (
        <div className="ac-audit-banner" role="status">
          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
          <div>
            <div className="ac-audit-title">Enforcement is currently off</div>
            <div className="ac-audit-desc">
              Rules below are saved and evaluated, but refused calls are only
              logged — nobody is actually blocked. Set{" "}
              <code>ACCESS_CONTROL_ENABLED=true</code> to start enforcing.
            </div>
          </div>
        </div>
      )}

      {/* ── The gate chain: the whole feature, shown rather than described ── */}
      <div className="ac-chain">
        <div className="ac-gate">
          <div className="ac-gate-step">1</div>
          <div>
            <div className="ac-gate-title">On the allow list</div>
            <div className="ac-gate-desc">
              Their email address — or its whole domain — must be listed and
              switched on for this environment.
            </div>
            <div
              className={`ac-gate-metric${enabledRules ? "" : " ac-muted"}`}
            >
              {enabledRules} active
              {domainRules > 0 && ` · ${domainRules} by domain`}
            </div>
          </div>
        </div>

        <div className="ac-gate">
          <div className="ac-gate-step">2</div>
          <div>
            <div className="ac-gate-title">“{fieldName}” is Enabled</div>
            <div className="ac-gate-desc">
              Read live from the caller&apos;s own Wrike profile on every
              request. Anything other than <strong>Enabled</strong> is refused.
            </div>
            <div className="ac-gate-metric ac-muted">Managed in Wrike</div>
          </div>
        </div>

        <div className="ac-gate">
          <div className="ac-gate-step">3</div>
          <div>
            <div className="ac-gate-title">Allowed to do it</div>
            <div className="ac-gate-desc">
              Read, Create, Update and Delete are granted separately — by
              allow-list entry, or per person.
            </div>
            <div
              className={`ac-gate-metric${
                permissions.length ? "" : " ac-muted"
              }`}
            >
              {permissions.length} individual grant
              {permissions.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="ac-tabs" role="tablist" aria-label="Access control views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`ac-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`ac-panel-${t.id}`}
            className="ac-tab"
            onClick={() => setTab(t.id)}
          >
            <i className={`fa-solid ${t.icon}`} aria-hidden="true" />
            {t.label}
            {t.id === "allowlist" && rules.length > 0 && (
              <span className="ac-tab-count">{rules.length}</span>
            )}
            {t.id === "permissions" && permissions.length > 0 && (
              <span className="ac-tab-count">{permissions.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════ ALLOW LIST ══════════ */}
      {tab === "allowlist" && (
        <div
          className="ac-panel"
          role="tabpanel"
          id="ac-panel-allowlist"
          aria-labelledby="ac-tab-allowlist"
        >
          <div className="ac-toolbar">
            <div className="ac-search">
              <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
              <input
                type="search"
                value={search}
                placeholder="Search addresses and domains…"
                aria-label="Search the allow list"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="ac-toolbar-actions">
              <button type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setBulkModal({ open: true, text: "", grant: EMPTY_GRANT })
                }
              >
                <i className="fa-solid fa-list-check" aria-hidden="true" />
                &nbsp;Add many
              </button>
              <button type="button"
                className="btn btn-primary btn-sm"
                onClick={() => openRuleModal(null)}
              >
                <i className="fa-solid fa-plus" aria-hidden="true" />
                &nbsp;Add entry
              </button>
            </div>
          </div>

          <div className="ac-table-card">
            <div className="ac-scroll">
              <table className="ac-table">
                <caption className="sr-only">
                  Email addresses and domains allowed to call the API in{" "}
                  {selectedEnv?.environment_name}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Allowed</th>
                    <th scope="col">Type</th>
                    <th scope="col">Default access</th>
                    <th scope="col">Switch</th>
                    <th scope="col" className="ac-col-actions">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <SkeletonRows columns={5} />}

                  {!loading &&
                    filteredRules.map((rule, index) => (
                      <tr
                        key={rule.id}
                        className="ac-row-in"
                        style={
                          {
                            "--row-index": Math.min(index, STAGGER_LIMIT),
                          } as React.CSSProperties
                        }
                      >
                        <td>
                          <div className="ac-identity">
                            <span
                              className={`ac-identity-icon${
                                rule.rule_type === "domain" ? " ac-domain" : ""
                              }`}
                              aria-hidden="true"
                            >
                              <i
                                className={`fa-solid ${
                                  rule.rule_type === "domain"
                                    ? "fa-building"
                                    : "fa-user"
                                }`}
                              />
                            </span>
                            <div className="ac-identity-main">
                              <div className="ac-identity-value">
                                {rule.rule_type === "domain"
                                  ? `@${rule.value}`
                                  : rule.value}
                              </div>
                              {rule.label && (
                                <div className="ac-identity-sub">
                                  {rule.label}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="ac-type-badge">
                            {rule.rule_type === "domain"
                              ? "Whole domain"
                              : "One person"}
                          </span>
                        </td>
                        <td>
                          <GrantPills
                            grant={rule}
                            busy={
                              savingCell?.id === rule.id
                                ? savingCell.action
                                : null
                            }
                            disabled={!rule.is_enabled}
                            onToggle={(action, next) =>
                              toggleRuleGrant(rule, action, next)
                            }
                          />
                        </td>
                        <td>
                          <label
                            className="toggle-wrap"
                            title={
                              rule.is_enabled
                                ? "Switch off to block this entry without deleting it"
                                : "Switch on to restore access"
                            }
                          >
                            <input
                              type="checkbox"
                              checked={rule.is_enabled}
                              aria-label={`Access for ${rule.value}`}
                              onChange={() => toggleRuleEnabled(rule)}
                            />
                            <div className="toggle-track" />
                          </label>
                        </td>
                        <td className="ac-col-actions">
                          <div className="ac-row-actions">
                            <button type="button"
                              className="ac-icon-btn"
                              title="Edit entry"
                              aria-label={`Edit ${rule.value}`}
                              onClick={() => openRuleModal(rule)}
                            >
                              <i className="fa-solid fa-pen" />
                            </button>
                            <button type="button"
                              className="ac-icon-btn ac-danger"
                              title="Remove entry"
                              aria-label={`Remove ${rule.value}`}
                              onClick={() => removeRule(rule)}
                            >
                              <i className="fa-solid fa-trash" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {!loading && rules.length === 0 && (
              <EmptyState
                icon="fa-address-book"
                title="Nobody can call this environment yet"
                desc="Until someone is on the allow list, every API and MCP request to this environment is refused. Add a colleague's email, or allow your whole company domain in one entry."
                action={
                  <button type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => openRuleModal(null)}
                  >
                    <i className="fa-solid fa-plus" aria-hidden="true" />
                    &nbsp;Add the first entry
                  </button>
                }
              />
            )}

            {!loading && rules.length > 0 && filteredRules.length === 0 && (
              <EmptyState
                icon="fa-magnifying-glass"
                title="Nothing matches that search"
                desc={`No allow-list entry contains “${search}”.`}
              />
            )}
          </div>
        </div>
      )}

      {/* ══════════ PERMISSIONS ══════════ */}
      {tab === "permissions" && (
        <div
          className="ac-panel"
          role="tabpanel"
          id="ac-panel-permissions"
          aria-labelledby="ac-tab-permissions"
        >
          <div className="ac-toolbar">
            <div className="ac-search">
              <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
              <input
                type="search"
                value={search}
                placeholder="Search people…"
                aria-label="Search granted users"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="ac-toolbar-actions">
              <button type="button"
                className="btn btn-primary btn-sm"
                onClick={() => openUserModal(null)}
              >
                <i className="fa-solid fa-user-plus" aria-hidden="true" />
                &nbsp;Grant access
              </button>
            </div>
          </div>

          <div className="ac-table-card">
            <div className="ac-scroll">
              <table className="ac-table">
                <caption className="sr-only">
                  Individual permission grants in{" "}
                  {selectedEnv?.environment_name}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Can do</th>
                    <th scope="col">Also on the allow list?</th>
                    <th scope="col" className="ac-col-actions">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <SkeletonRows columns={4} />}

                  {!loading &&
                    filteredPermissions.map((permission, index) => {
                      const domain = permission.email.split("@")[1] || "";
                      const covering =
                        rules.find(
                          (r) =>
                            r.rule_type === "email" &&
                            r.value === permission.email,
                        ) ||
                        rules.find(
                          (r) => r.rule_type === "domain" && r.value === domain,
                        );

                      return (
                        <tr
                          key={permission.id}
                          className="ac-row-in"
                          style={
                            {
                              "--row-index": Math.min(index, STAGGER_LIMIT),
                            } as React.CSSProperties
                          }
                        >
                          <td>
                            <div className="ac-identity">
                              <span className="ac-identity-icon" aria-hidden="true">
                                {permission.email.charAt(0).toUpperCase()}
                              </span>
                              <div className="ac-identity-main">
                                <div className="ac-identity-value">
                                  {permission.display_name || permission.email}
                                </div>
                                {permission.display_name && (
                                  <div className="ac-identity-sub">
                                    {permission.email}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>
                            {grantedActions(permission).length === 0 ? (
                              <span className="ac-grant-none">
                                Nothing — effectively blocked
                              </span>
                            ) : null}
                            <GrantPills
                              grant={permission}
                              busy={
                                savingCell?.id === permission.id
                                  ? savingCell.action
                                  : null
                              }
                              onToggle={(action, next) =>
                                togglePermissionGrant(permission, action, next)
                              }
                            />
                          </td>
                          <td>
                            {covering ? (
                              <span className="ac-source">
                                Yes —{" "}
                                <strong>
                                  {covering.rule_type === "domain"
                                    ? `@${covering.value}`
                                    : covering.value}
                                </strong>
                                {!covering.is_enabled && " (switched off)"}
                              </span>
                            ) : (
                              <span
                                className="badge badge-warning"
                                title="These permissions have no effect until this person is also on the allow list"
                              >
                                <i className="fa-solid fa-triangle-exclamation" />
                                &nbsp;Not listed
                              </span>
                            )}
                          </td>
                          <td className="ac-col-actions">
                            <div className="ac-row-actions">
                              <button type="button"
                                className="ac-icon-btn"
                                title="Edit person"
                                aria-label={`Edit ${permission.email}`}
                                onClick={() => openUserModal(permission)}
                              >
                                <i className="fa-solid fa-pen" />
                              </button>
                              <button type="button"
                                className="ac-icon-btn ac-danger"
                                title="Remove per-user access"
                                aria-label={`Remove ${permission.email}`}
                                onClick={() => removePermission(permission)}
                              >
                                <i className="fa-solid fa-trash" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {!loading && permissions.length === 0 && (
              <EmptyState
                icon="fa-user-shield"
                title="Everyone is using their default access"
                desc="People on the allow list already get whatever their entry grants. Add someone here only when they need something different — a colleague who may delete, or one who should be read-only."
                action={
                  <button type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => openUserModal(null)}
                  >
                    <i className="fa-solid fa-user-plus" aria-hidden="true" />
                    &nbsp;Grant access to someone
                  </button>
                }
              />
            )}

            {!loading &&
              permissions.length > 0 &&
              filteredPermissions.length === 0 && (
                <EmptyState
                  icon="fa-magnifying-glass"
                  title="Nothing matches that search"
                  desc={`Nobody granted here matches “${search}”.`}
                />
              )}
          </div>
        </div>
      )}

      {/* ══════════ ACCESS CHECK ══════════ */}
      {tab === "check" && (
        <div
          className="ac-panel ac-sim-layout"
          role="tabpanel"
          id="ac-panel-check"
          aria-labelledby="ac-tab-check"
        >
          <div className="card ac-sim-form">
            <div className="card-body">
              <p className="ac-sim-hint">
                Enter someone&apos;s Wrike email to see exactly what would
                happen if they called the API in{" "}
                <strong>{selectedEnv?.environment_name}</strong> right now.
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  runSimulation();
                }}
              >
                <div className="form-group">
                  <label className="form-label" htmlFor="ac-sim-email">
                    Email address
                  </label>
                  <input
                    id="ac-sim-email"
                    className="form-control"
                    type="email"
                    autoComplete="off"
                    placeholder="person@company.com"
                    value={simEmail}
                    onChange={(e) => setSimEmail(e.target.value)}
                  />
                </div>

                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={simBusy}
                  style={{ width: "100%" }}
                >
                  <i
                    className={`fa-solid ${
                      simBusy ? "fa-spinner fa-spin" : "fa-play"
                    }`}
                    aria-hidden="true"
                  />
                  &nbsp;{simBusy ? "Checking…" : "Run the check"}
                </button>
              </form>
            </div>
          </div>

          <div className="card">
            {!simResult && (
              <EmptyState
                icon="fa-vial-circle-check"
                title="No check run yet"
                desc="The result shows each of the three gates in order, so you can see precisely which one would stop someone — and fix that one."
              />
            )}

            {simResult && (
              <>
                <div
                  className={`ac-verdict ${
                    simResult.allowed ? "ac-verdict-allow" : "ac-verdict-deny"
                  }`}
                >
                  <div className="ac-verdict-icon">
                    <i
                      className={`fa-solid ${
                        simResult.allowed
                          ? "fa-circle-check"
                          : "fa-circle-xmark"
                      }`}
                      aria-hidden="true"
                    />
                  </div>
                  <div>
                    <div className="ac-verdict-title">
                      {simResult.allowed
                        ? "Would be let through"
                        : "Would be refused"}
                    </div>
                    <div className="ac-verdict-sub">{simResult.email}</div>
                  </div>
                </div>

                <div className="ac-pipeline">
                  {simResult.gates.map((gate, index) => (
                    <div
                      key={gate.key}
                      className={`ac-step ac-step-${gate.status}`}
                      style={
                        { "--step-index": index } as React.CSSProperties
                      }
                    >
                      <div className="ac-step-icon">
                        <i
                          className={`fa-solid ${GATE_ICONS[gate.status]}`}
                          aria-hidden="true"
                        />
                      </div>
                      <div>
                        <div className="ac-step-label">
                          {gate.label}
                          {gate.status === "pending" && " — checked live"}
                        </div>
                        <div className="ac-step-detail">{gate.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="ac-sim-result-grants">
                  <span className="ac-sim-result-label">
                    Resulting permissions
                  </span>
                  <GrantPills
                    grant={{
                      can_read: !!simResult.permissions?.read,
                      can_create: !!simResult.permissions?.create,
                      can_update: !!simResult.permissions?.update,
                      can_delete: !!simResult.permissions?.delete,
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

        </div>

      {/* ══════════ ADD / EDIT ALLOW-LIST ENTRY ══════════ */}
      <div className={`modal-backdrop${ruleModal.open ? " open" : ""}`}>
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label={
            ruleModal.editing ? "Edit allow-list entry" : "Add allow-list entry"
          }
          style={{ maxWidth: 520 }}
        >
          <div className="modal-header">
            <div className="modal-title">
              <i className="fa-solid fa-address-book" />
              {ruleModal.editing ? "Edit entry" : "Add to allow list"}
            </div>
            <button type="button"
              className="modal-close"
              aria-label="Close"
              onClick={() => setRuleModal((m) => ({ ...m, open: false }))}
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>

          <div className="modal-body">
            <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
              {!ruleModal.editing && (
                <div className="form-group">
                  <label className="form-label">Who does this cover?</label>
                  <div className="ac-segmented">
                    <button
                      type="button"
                      className="ac-segment"
                      aria-pressed={ruleModal.ruleType === "email"}
                      onClick={() =>
                        setRuleModal((m) => ({ ...m, ruleType: "email" }))
                      }
                    >
                      <span className="ac-segment-title">
                        <i className="fa-solid fa-user" aria-hidden="true" />
                        One person
                      </span>
                      <span className="ac-segment-desc">
                        A single email address
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ac-segment"
                      aria-pressed={ruleModal.ruleType === "domain"}
                      onClick={() =>
                        setRuleModal((m) => ({ ...m, ruleType: "domain" }))
                      }
                    >
                      <span className="ac-segment-title">
                        <i className="fa-solid fa-building" aria-hidden="true" />
                        Whole domain
                      </span>
                      <span className="ac-segment-desc">
                        Everyone with that email domain
                      </span>
                    </button>
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="ac-rule-value">
                  {ruleModal.ruleType === "domain"
                    ? "Domain"
                    : "Email address"}
                </label>
                <input
                  id="ac-rule-value"
                  className="form-control"
                  type="text"
                  placeholder={
                    ruleModal.ruleType === "domain"
                      ? "company.com"
                      : "person@company.com"
                  }
                  value={ruleModal.value}
                  onChange={(e) =>
                    setRuleModal((m) => ({ ...m, value: e.target.value }))
                  }
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="ac-rule-label">
                  Note <span style={{ color: "var(--text-muted)" }}>— optional</span>
                </label>
                <input
                  id="ac-rule-label"
                  className="form-control"
                  type="text"
                  placeholder="e.g. Marketing ops team"
                  value={ruleModal.label}
                  onChange={(e) =>
                    setRuleModal((m) => ({ ...m, label: e.target.value }))
                  }
                />
              </div>

              <hr className="form-divider" />

              <div className="form-group">
                <label className="form-label">Default access</label>
                <p
                  style={{
                    fontSize: 12.5,
                    color: "var(--text-muted)",
                    marginBottom: 10,
                    lineHeight: 1.5,
                  }}
                >
                  What everyone matched by this entry can do, unless you grant
                  them something different individually.
                </p>
                <GrantPicker
                  grant={ruleModal.grant}
                  onChange={(grant) => setRuleModal((m) => ({ ...m, grant }))}
                />
              </div>
            </form>
          </div>

          <div className="modal-footer">
            <button type="button"
              className="btn btn-ghost"
              onClick={() => setRuleModal((m) => ({ ...m, open: false }))}
            >
              Cancel
            </button>
            <button type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={submitRule}
            >
              <i
                className={`fa-solid ${
                  saving ? "fa-spinner fa-spin" : "fa-check"
                }`}
                aria-hidden="true"
              />
              &nbsp;{ruleModal.editing ? "Save changes" : "Add entry"}
            </button>
          </div>
        </div>
      </div>

      {/* ══════════ BULK ADD ══════════ */}
      <div className={`modal-backdrop${bulkModal.open ? " open" : ""}`}>
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="Add many allow-list entries"
          style={{ maxWidth: 560 }}
        >
          <div className="modal-header">
            <div className="modal-title">
              <i className="fa-solid fa-list-check" />
              Add many at once
            </div>
            <button type="button"
              className="modal-close"
              aria-label="Close"
              onClick={() => setBulkModal((m) => ({ ...m, open: false }))}
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>

          <div className="modal-body">
            <div className="form-group">
              <label className="form-label" htmlFor="ac-bulk">
                Paste email addresses or domains
              </label>
              <p
                style={{
                  fontSize: 12.5,
                  color: "var(--text-muted)",
                  marginBottom: 10,
                  lineHeight: 1.5,
                }}
              >
                One per line, or separated by commas. Write a domain as{" "}
                <code>@company.com</code>. Anything already on the list is
                skipped, so pasting twice is safe.
              </p>
              <textarea
                id="ac-bulk"
                className="ac-textarea"
                placeholder={"alex@company.com\njordan@company.com\n@partner.com"}
                value={bulkModal.text}
                onChange={(e) =>
                  setBulkModal((m) => ({ ...m, text: e.target.value }))
                }
              />
            </div>

            <hr className="form-divider" />

            <div className="form-group">
              <label className="form-label">Default access for all of them</label>
              <GrantPicker
                grant={bulkModal.grant}
                onChange={(grant) => setBulkModal((m) => ({ ...m, grant }))}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button"
              className="btn btn-ghost"
              onClick={() => setBulkModal((m) => ({ ...m, open: false }))}
            >
              Cancel
            </button>
            <button type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={submitBulk}
            >
              <i
                className={`fa-solid ${
                  saving ? "fa-spinner fa-spin" : "fa-plus"
                }`}
                aria-hidden="true"
              />
              &nbsp;Add them
            </button>
          </div>
        </div>
      </div>

      {/* ══════════ GRANT / EDIT USER ══════════ */}
      <div className={`modal-backdrop${userModal.open ? " open" : ""}`}>
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label={
            userModal.editing ? "Edit user permissions" : "Grant user access"
          }
          style={{ maxWidth: 520 }}
        >
          <div className="modal-header">
            <div className="modal-title">
              <i className="fa-solid fa-user-shield" />
              {userModal.editing ? "Edit permissions" : "Grant access"}
            </div>
            <button type="button"
              className="modal-close"
              aria-label="Close"
              onClick={() => setUserModal((m) => ({ ...m, open: false }))}
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>

          <div className="modal-body">
            <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
              <div className="form-group">
                <label className="form-label" htmlFor="ac-user-email">
                  Wrike email address
                </label>
                <input
                  id="ac-user-email"
                  className="form-control"
                  type="email"
                  placeholder="person@company.com"
                  value={userModal.email}
                  readOnly={!!userModal.editing}
                  onChange={(e) =>
                    setUserModal((m) => ({ ...m, email: e.target.value }))
                  }
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="ac-user-name">
                  Name{" "}
                  <span style={{ color: "var(--text-muted)" }}>— optional</span>
                </label>
                <input
                  id="ac-user-name"
                  className="form-control"
                  type="text"
                  placeholder="Alex Morgan"
                  value={userModal.displayName}
                  onChange={(e) =>
                    setUserModal((m) => ({ ...m, displayName: e.target.value }))
                  }
                />
              </div>

              <hr className="form-divider" />

              <div className="form-group">
                <label className="form-label">What they can do</label>
                <p
                  style={{
                    fontSize: 12.5,
                    color: "var(--text-muted)",
                    marginBottom: 10,
                    lineHeight: 1.5,
                  }}
                >
                  This replaces whatever their allow-list entry would have
                  given them. They still need to be on the allow list, and to
                  have “{fieldName}” enabled in Wrike.
                </p>
                <GrantPicker
                  grant={userModal.grant}
                  onChange={(grant) => setUserModal((m) => ({ ...m, grant }))}
                />
              </div>
            </form>
          </div>

          <div className="modal-footer">
            <button type="button"
              className="btn btn-ghost"
              onClick={() => setUserModal((m) => ({ ...m, open: false }))}
            >
              Cancel
            </button>
            <button type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={submitUser}
            >
              <i
                className={`fa-solid ${
                  saving ? "fa-spinner fa-spin" : "fa-check"
                }`}
                aria-hidden="true"
              />
              &nbsp;Save access
            </button>
          </div>
        </div>
      </div>
      </aside>
    </div>
  );
}
