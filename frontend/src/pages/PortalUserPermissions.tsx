import { useEffect, useMemo, useState } from "react";
import {
  getPermissionCatalog,
  getUserPermissions,
  grantedCount,
  setUserPermissions,
  type ActionName,
  type PermissionCatalog,
  type PermissionMatrix,
} from "../lib/portalPermissionsApi";
import { progress, toast } from "../lib/notify";
import "./PortalUserPermissions.css";

const ACTION_LABEL: Record<ActionName, string> = {
  read: "Read",
  create: "Create",
  update: "Update",
  delete: "Delete",
};

const ACTIONS: ActionName[] = ["read", "create", "update", "delete"];

const MODULE_ICON: Record<string, string> = {
  overview: "fa-chart-pie",
  environments: "fa-layer-group",
  environment_access: "fa-shield-halved",
};

interface Props {
  userId: string | null;
  username: string | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Compact module-permission editor for one portal user — Read/Create/Update/
 * Delete per module, opened directly from that user's row (no separate
 * page). A small modal rather than a drawer: three modules by four actions
 * is twelve cells, which fits comfortably without needing the extra screen
 * real estate a slide-over reserves.
 */
export default function PortalUserPermissions({ userId, username, open, onClose }: Props) {
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [original, setOriginal] = useState<PermissionMatrix | null>(null);
  const [draft, setDraft] = useState<PermissionMatrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    if (!catalog) getPermissionCatalog().then(setCatalog).catch(() => {});

    if (!userId) return;
    setLoading(true);
    getUserPermissions(userId)
      .then((data) => {
        setOriginal(data);
        setDraft(data);
      })
      .catch((err) => {
        toast(err?.message || "Could not load permissions", "error");
        setOriginal(null);
        setDraft(null);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const modules = catalog?.modules || [];

  const counts = useMemo(
    () => (draft ? grantedCount(draft, modules) : { granted: 0, total: 0 }),
    [draft, modules],
  );

  const dirty = useMemo(() => {
    if (!draft || !original) return false;
    return JSON.stringify(draft) !== JSON.stringify(original);
  }, [draft, original]);

  const toggleCell = (moduleKey: string, action: ActionName) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [moduleKey]: { ...prev[moduleKey] } };
      const turningOn = !next[moduleKey][action];
      next[moduleKey][action] = turningOn;

      // Read is the floor: nothing can be created, changed or removed if it
      // can't be seen, so granting a write implies read, and taking read
      // away takes the writes that depended on it with it. A cell combination
      // the console itself can't produce is one it never has to explain.
      if (turningOn && action !== "read") next[moduleKey].read = true;
      if (!turningOn && action === "read") {
        next[moduleKey].create = false;
        next[moduleKey].update = false;
        next[moduleKey].delete = false;
      }

      return next;
    });
  };

  // Per-row shortcut: everything this module supports, or nothing.
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

  /**
   * One switch for every module at once: No access, Read only, or Full
   * access. "Full" means each module's own maximum, not literally every
   * action on every module. Overview only supports read, so "Full" gives it
   * read, the same as "Read only" would, while Environments and Environment
   * Access get all four.
   */
  const applyGlobalPreset = (preset: "off" | "read" | "full") => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next: PermissionMatrix = {};
      for (const mod of modules) {
        const row: Record<ActionName, boolean> = {
          read: false,
          create: false,
          update: false,
          delete: false,
        };
        if (preset === "read") row.read = true;
        if (preset === "full") for (const a of mod.actions) row[a] = true;
        next[mod.key] = row;
      }
      return next;
    });
  };

  /**
   * Which global preset the whole matrix currently matches exactly, or null
   * when modules disagree (some off, some read-only, some hand-tuned) — the
   * common case once an admin starts customising. Null means no segment
   * lights up, rather than guessing at the closest one.
   */
  const globalPreset = useMemo((): "off" | "read" | "full" | null => {
    if (!draft || !modules.length) return null;

    const matches = (want: "off" | "read" | "full") =>
      modules.every((mod) => {
        const row = draft[mod.key];
        if (!row) return want === "off";
        if (want === "off") return mod.actions.every((a) => !row[a]);
        if (want === "read") {
          return mod.actions.every((a) => (a === "read" ? row[a] : !row[a]));
        }
        return mod.actions.every((a) => row[a]);
      });

    if (matches("off")) return "off";
    if (matches("read")) return "read";
    if (matches("full")) return "full";
    return null;
  }, [draft, modules]);

  const save = async () => {
    if (!userId || !draft) return;
    setSaving(true);
    progress.start();
    try {
      const saved = await setUserPermissions(userId, draft);
      setOriginal(saved);
      setDraft(saved);
      toast(`Permissions saved for ${username || "user"}`, "success");
    } catch (err: any) {
      toast(err?.message || "Could not save permissions", "error");
    } finally {
      setSaving(false);
      progress.done();
    }
  };

  return (
    <div
      className={`pup-backdrop${open ? " open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pup-modal" role="dialog" aria-modal="true" aria-label="User permissions">
        <div className="pup-head">
          <div className="pup-head-title">
            <span className="pup-head-icon" aria-hidden="true">
              <i className="fa-solid fa-user-shield" />
            </span>
            <div>
              <div className="pup-head-name">Permissions</div>
              <div className="pup-head-user">{username || "—"}</div>
            </div>
          </div>
          <button type="button" className="pup-close" aria-label="Close" onClick={onClose}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="pup-body">
          {loading && (
            <div className="pup-skeleton-stack">
              {Array.from({ length: 3 }).map((_, i) => (
                <div className="pup-skeleton" key={i} />
              ))}
            </div>
          )}

          {!loading && (
            <>
              <p className="pup-hint">
                What <strong>{username || "this user"}</strong> can see and change in the portal.
                Grant what each area needs, nothing more.
              </p>

              <div className="pup-global" role="group" aria-label="Set access for every module">
                <span className="pup-global-label">Quick set, all modules</span>
                <div className="pup-global-switch">
                  <button
                    type="button"
                    className="pup-global-seg"
                    aria-pressed={globalPreset === "off"}
                    onClick={() => applyGlobalPreset("off")}
                  >
                    <i className="fa-solid fa-ban" aria-hidden="true" />
                    No access
                  </button>
                  <button
                    type="button"
                    className="pup-global-seg"
                    aria-pressed={globalPreset === "read"}
                    onClick={() => applyGlobalPreset("read")}
                  >
                    <i className="fa-solid fa-eye" aria-hidden="true" />
                    Read only
                  </button>
                  <button
                    type="button"
                    className="pup-global-seg"
                    aria-pressed={globalPreset === "full"}
                    onClick={() => applyGlobalPreset("full")}
                  >
                    <i className="fa-solid fa-pen" aria-hidden="true" />
                    Full access
                  </button>
                </div>
              </div>

              <div className="pup-matrix">
                <div className="pup-matrix-head" aria-hidden="true">
                  <span className="pup-matrix-head-module" />
                  {ACTIONS.map((action) => (
                    <span className="pup-matrix-head-cell" key={action}>
                      {ACTION_LABEL[action]}
                    </span>
                  ))}
                  <span className="pup-matrix-head-all" />
                </div>

                {modules.map((mod) => {
                  const row = draft?.[mod.key];
                  const allOn = mod.actions.every((a) => row?.[a]);

                  return (
                    <div className="pup-matrix-row" key={mod.key}>
                      <div className="pup-module">
                        <span className="pup-module-icon" aria-hidden="true">
                          <i className={`fa-solid ${MODULE_ICON[mod.key] || "fa-cube"}`} />
                        </span>
                        <span className="pup-module-text">
                          <span className="pup-module-label">{mod.label}</span>
                          <span className="pup-module-desc">{mod.description}</span>
                        </span>
                      </div>

                      {ACTIONS.map((action) => {
                        const supported = mod.actions.includes(action);
                        const checked = !!row?.[action];

                        return (
                          <div className="pup-matrix-cell" key={action}>
                            {supported ? (
                              <label className="pup-tick-wrap">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleCell(mod.key, action)}
                                  aria-label={`${ACTION_LABEL[action]} on ${mod.label}`}
                                />
                                <span className="pup-tick" aria-hidden="true">
                                  <i className="fa-solid fa-check" />
                                </span>
                              </label>
                            ) : (
                              <span
                                className="pup-na"
                                title={`${mod.label} has nothing to ${action}`}
                                aria-hidden="true"
                              >
                                —
                              </span>
                            )}
                          </div>
                        );
                      })}

                      <div className="pup-matrix-cell">
                        <button
                          type="button"
                          className="pup-rowtoggle"
                          onClick={() => toggleModuleRow(mod.key, allOn)}
                        >
                          {allOn ? "None" : "All"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="pup-footer">
          <span className="pup-footer-count">
            {counts.granted} of {counts.total} granted
          </span>
          <div className="pup-footer-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!dirty || saving || loading}
              onClick={save}
            >
              <i
                className={`fa-solid ${saving ? "fa-spinner fa-spin" : "fa-check"}`}
                aria-hidden="true"
              />
              &nbsp;Save permissions
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
