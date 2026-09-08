import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getPermissionCatalog,
  getUserAccessSummary,
  grantedCount,
  roleForMatrix,
  roleLabel,
  setUserPermissions,
  type ActionName,
  type PermissionCatalog,
  type PermissionMatrix,
  type UserAccessSummary,
} from "../lib/permissionsApi";
import { progress, toast } from "../lib/notify";
import "./UserPermissions.css";

const ACTION_LABEL: Record<ActionName, string> = {
  read: "Read",
  create: "Create",
  update: "Update",
  delete: "Delete",
};

const ACTIONS: ActionName[] = ["read", "create", "update", "delete"];

const MODULE_ICONS: Record<string, string> = {
  overview: "fa-chart-pie",
  environments: "fa-layer-group",
  users: "fa-users",
  api_access: "fa-shield-halved",
};

const ROLE_ICONS: Record<string, string> = {
  no_access: "fa-ban",
  viewer: "fa-eye",
  contributor: "fa-pen",
  administrator: "fa-user-shield",
};

interface Props {
  userId: string | null;
  open: boolean;
  onClose: () => void;
  /** Lets the parent refresh its own list after a save. */
  onSaved?: () => void;
}

/**
 * The single answer to "what can this person actually do?" — portal role,
 * environment scope, and the module matrix, in one panel.
 *
 * A right-hand drawer rather than a centred modal: the matrix is tall and
 * naturally list-shaped, and a drawer keeps the user list visible behind it
 * so an admin reviewing several people never loses their place.
 */
export default function UserPermissions({
  userId,
  open,
  onClose,
  onSaved,
}: Props) {
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [summary, setSummary] = useState<UserAccessSummary | null>(null);
  const [draft, setDraft] = useState<PermissionMatrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Catalog is vocabulary, not user data — fetch once and keep it.
  useEffect(() => {
    if (!open || catalog) return;
    getPermissionCatalog().then(setCatalog).catch(() => {});
  }, [open, catalog]);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await getUserAccessSummary(userId);
      setSummary(data);
      setDraft(data.permissions);
    } catch (err: any) {
      toast(err?.message || "Could not load permissions", "error");
      setSummary(null);
      setDraft(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (open && userId) load();
  }, [open, userId, load]);

  // Esc closes, matching every other dismissible surface in the console.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const modules = catalog?.modules || [];

  const currentRole = useMemo(
    () => (draft ? roleForMatrix(draft, catalog) : null),
    [draft, catalog],
  );

  const counts = useMemo(
    () => (draft ? grantedCount(draft, modules) : { granted: 0, total: 0 }),
    [draft, modules],
  );

  const dirty = useMemo(() => {
    if (!draft || !summary) return false;
    return JSON.stringify(draft) !== JSON.stringify(summary.permissions);
  }, [draft, summary]);

  const toggleCell = (moduleKey: string, action: ActionName) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [moduleKey]: { ...prev[moduleKey] } };
      const turningOn = !next[moduleKey][action];
      next[moduleKey][action] = turningOn;

      // Read is the floor: you cannot create/update/delete something you
      // can't see, so granting any write implies read, and removing read
      // removes the writes that depended on it. Silently allowing an
      // impossible combination would make the matrix lie.
      if (turningOn && action !== "read") next[moduleKey].read = true;
      if (!turningOn && action === "read") {
        next[moduleKey].create = false;
        next[moduleKey].update = false;
        next[moduleKey].delete = false;
      }

      return next;
    });
  };

  const applyRole = (roleKey: string) => {
    const role = catalog?.roles.find((r) => r.key === roleKey);
    if (!role) return;
    // Structured clone so editing a cell afterwards can't mutate the catalog's
    // own preset and quietly corrupt every later "apply role" click.
    setDraft(JSON.parse(JSON.stringify(role.permissions)));
  };

  const toggleModuleRow = (moduleKey: string, allOn: boolean) => {
    const mod = modules.find((m) => m.key === moduleKey);
    if (!mod) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const row: Record<ActionName, boolean> = {
        read: false,
        create: false,
        update: false,
        delete: false,
      };
      if (!allOn) for (const a of mod.actions) row[a] = true;
      return { ...prev, [moduleKey]: row };
    });
  };

  const save = async () => {
    if (!userId || !draft) return;
    setSaving(true);
    progress.start();
    try {
      await setUserPermissions(userId, draft);
      toast("Permissions updated", "success");
      await load();
      onSaved?.();
    } catch (err: any) {
      toast(err?.message || "Could not save permissions", "error");
    } finally {
      setSaving(false);
      progress.done();
    }
  };

  const person =
    summary?.user.full_name || summary?.user.username || "this user";

  return (
    <div
      className={`up-scrim${open ? " open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="up-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="User permissions"
      >
        <header className="up-header">
          <div className="up-header-main">
            <div className="up-avatar" aria-hidden="true">
              {(summary?.user.username || "?").charAt(0).toUpperCase()}
            </div>
            <div className="up-identity">
              <div className="up-name">{person}</div>
              <div className="up-sub">
                {summary?.user.email || summary?.user.username || "—"}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="up-close"
            aria-label="Close"
            onClick={onClose}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </header>

        <div className="up-body">
          {loading && (
            <div className="up-skeleton-stack">
              {Array.from({ length: 6 }).map((_, i) => (
                <div className="up-skeleton" key={i} />
              ))}
            </div>
          )}

          {!loading && summary && (
            <>
              {/* ── Environment scope ── */}
              <section className="up-section">
                <div className="up-section-head">
                  <h3 className="up-section-title">
                    <i className="fa-solid fa-crosshairs" aria-hidden="true" />
                    Environment scope
                  </h3>
                  <span className="up-section-note">
                    Where the permissions below apply
                  </span>
                </div>

                {summary.environment_scope.length === 0 ? (
                  <div className="up-scope-empty">
                    <i
                      className="fa-solid fa-circle-info"
                      aria-hidden="true"
                    />
                    <span>
                      No environments assigned. Everything below is inert until{" "}
                      {person} is given at least one environment — assign one
                      from the user&apos;s <strong>Manage Environments</strong>{" "}
                      action.
                    </span>
                  </div>
                ) : (
                  <div className="up-scope-list">
                    {summary.environment_scope.map((env) => (
                      <span className="up-scope-chip" key={env.id}>
                        <i
                          className="fa-solid fa-layer-group"
                          aria-hidden="true"
                        />
                        {env.environment_name}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              {/* ── Role presets ── */}
              <section className="up-section">
                <div className="up-section-head">
                  <h3 className="up-section-title">
                    <i className="fa-solid fa-id-badge" aria-hidden="true" />
                    Role
                  </h3>
                  <span
                    className={`up-role-pill${currentRole ? "" : " up-custom"}`}
                  >
                    {roleLabel(currentRole, catalog)}
                  </span>
                </div>

                <div className="up-roles">
                  {(catalog?.roles || []).map((role) => (
                    <button
                      type="button"
                      key={role.key}
                      className="up-role"
                      aria-pressed={currentRole === role.key}
                      onClick={() => applyRole(role.key)}
                    >
                      <span className="up-role-title">
                        <i
                          className={`fa-solid ${
                            ROLE_ICONS[role.key] || "fa-circle"
                          }`}
                          aria-hidden="true"
                        />
                        {role.label}
                      </span>
                      <span className="up-role-desc">{role.description}</span>
                    </button>
                  ))}
                </div>
                <p className="up-hint">
                  A role is a shortcut, not a lock — tick anything below and
                  the role simply becomes <strong>Custom</strong>.
                </p>
              </section>

              {/* ── Module matrix ── */}
              <section className="up-section">
                <div className="up-section-head">
                  <h3 className="up-section-title">
                    <i className="fa-solid fa-table-cells" aria-hidden="true" />
                    Module permissions
                  </h3>
                  <span className="up-section-note">
                    {counts.granted} of {counts.total} granted
                  </span>
                </div>

                <div className="up-matrix-scroll">
                  <table className="up-matrix">
                    <thead>
                      <tr>
                        <th scope="col">Module</th>
                        {ACTIONS.map((action) => (
                          <th scope="col" key={action} className="up-col">
                            {ACTION_LABEL[action]}
                          </th>
                        ))}
                        <th scope="col" className="up-col" />
                      </tr>
                    </thead>
                    <tbody>
                      {modules.map((mod) => {
                        const row = draft?.[mod.key];
                        const allOn = mod.actions.every((a) => row?.[a]);

                        return (
                          <tr key={mod.key}>
                            <th scope="row" className="up-module">
                              <span className="up-module-icon" aria-hidden="true">
                                <i
                                  className={`fa-solid ${
                                    MODULE_ICONS[mod.key] || "fa-cube"
                                  }`}
                                />
                              </span>
                              <span>
                                <span className="up-module-label">
                                  {mod.label}
                                </span>
                                <span className="up-module-desc">
                                  {mod.description}
                                </span>
                              </span>
                            </th>

                            {ACTIONS.map((action) => {
                              const supported = mod.actions.includes(action);
                              const checked = !!row?.[action];

                              return (
                                <td key={action} className="up-col">
                                  {supported ? (
                                    <label className="up-cell">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() =>
                                          toggleCell(mod.key, action)
                                        }
                                        aria-label={`${ACTION_LABEL[action]} on ${mod.label}`}
                                      />
                                      <span className="up-tick" aria-hidden="true">
                                        <i className="fa-solid fa-check" />
                                      </span>
                                    </label>
                                  ) : (
                                    <span
                                      className="up-na"
                                      title={`${mod.label} has nothing to ${action}`}
                                      aria-label="Not applicable"
                                    >
                                      —
                                    </span>
                                  )}
                                </td>
                              );
                            })}

                            <td className="up-col">
                              <button
                                type="button"
                                className="up-rowtoggle"
                                onClick={() => toggleModuleRow(mod.key, allOn)}
                              >
                                {allOn ? "None" : "All"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>

        <footer className="up-footer">
          <span className="up-footer-state">
            {dirty ? (
              <>
                <i className="fa-solid fa-circle" aria-hidden="true" />
                Unsaved changes
              </>
            ) : (
              "All changes saved"
            )}
          </span>
          <div className="up-footer-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!dirty || saving}
              onClick={save}
            >
              <i
                className={`fa-solid ${
                  saving ? "fa-spinner fa-spin" : "fa-check"
                }`}
                aria-hidden="true"
              />
              &nbsp;Save permissions
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
