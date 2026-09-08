import { useCallback, useEffect, useMemo, useState } from "react";
import {
  checkAccess,
  createRule,
  deleteRule,
  getMyIp,
  inferRuleType,
  listRules,
  ruleTypeLabel,
  updateRule,
  type AccessRule,
  type CheckResult,
  type RuleType,
} from "../lib/environmentAccessApi";
import { toggleEnvironmentStatus, type AdminEnvironment } from "../lib/adminApi";
import { confirmDanger, escHtml, toast } from "../lib/notify";
import "./EnvironmentAccess.css";

type TabId = "allowlist" | "check";

const TYPE_ICON: Record<RuleType, string> = {
  email: "fa-user",
  domain: "fa-building",
  ip: "fa-network-wired",
};

const TYPE_PLACEHOLDER: Record<RuleType, string> = {
  email: "person@company.com",
  domain: "company.com",
  ip: "203.0.113.4 or 203.0.113.0/24",
};

interface Props {
  envId: string | null;
  envName: string | null;
  /** The full environment record — carries the two security switches below.
      Null for one tick while the parent's own list is still loading. */
  environment: AdminEnvironment | null;
  open: boolean;
  onClose: () => void;
  /** Lets the parent refresh its own row badge after a write. */
  onChanged?: () => void;
}

/**
 * Environment-level API access scope: an allow list of emails, domains, and
 * IP addresses/CIDR ranges. Match-any of the active entries grants access;
 * no match denies. One rule, shown as one table with a type column rather
 * than three tabs — the value the admin types decides its own type, and the
 * OR logic reads the same way the table does.
 *
 * A right-hand drawer opened from the environment row: the environment is
 * implicit in what was clicked, so there is no picker to re-ask.
 */
export default function EnvironmentAccess({
  envId,
  envName,
  environment,
  open,
  onClose,
  onChanged,
}: Props) {
  const [switchBusy, setSwitchBusy] = useState<
    "allowlist_check_enabled" | "custom_field_check_enabled" | null
  >(null);

  const toggleSwitch = async (
    field: "allowlist_check_enabled" | "custom_field_check_enabled",
    next: boolean,
  ) => {
    if (!envId) return;

    // Turning the allow-list gate off is the one switch that can genuinely
    // open an environment up — confirm before it takes effect, the same
    // pattern used for deleting an allow-list entry.
    if (field === "allowlist_check_enabled" && !next) {
      const ok = await confirmDanger({
        title: "Turn off the allow-list check?",
        html:
          `Every caller will pass this gate for <strong>${escHtml(
            envName || "this environment",
          )}</strong>. The entries below stop being enforced until you switch it back on.`,
        confirmText: "Turn off",
      });
      if (!ok) return;
    }

    setSwitchBusy(field);
    try {
      await toggleEnvironmentStatus(envId, { [field]: next });
      if (field === "allowlist_check_enabled") {
        toast(
          next
            ? "Allow-list check is back on"
            : "Allow-list check is off. Every caller passes this gate.",
          next ? "success" : "warning",
        );
      } else {
        toast(
          next ? "Custom field flag saved (not yet enforced)" : "Custom field flag saved",
          "info",
        );
      }
      onChanged?.();
    } catch (err: any) {
      toast(err?.message || "Could not change the switch", "error");
    } finally {
      setSwitchBusy(null);
    }
  };
  const [tab, setTab] = useState<TabId>("allowlist");

  const [rules, setRules] = useState<AccessRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<RuleType>("email");
  const [addValue, setAddValue] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addTypeTouched, setAddTypeTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fillingMyIp, setFillingMyIp] = useState(false);

  const useMyIp = async () => {
    setFillingMyIp(true);
    try {
      const { ip } = await getMyIp();
      if (!ip) {
        toast("Could not detect your IP", "error");
        return;
      }
      setAddValue(ip);
    } catch (err: any) {
      toast(err?.message || "Could not detect your IP", "error");
    } finally {
      setFillingMyIp(false);
    }
  };

  const [checkEmail, setCheckEmail] = useState("");
  const [checkIp, setCheckIp] = useState("");
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);

  const load = useCallback(async () => {
    if (!envId) return;
    setLoading(true);
    try {
      setRules(await listRules(envId));
    } catch (err: any) {
      toast(err?.message || "Could not load the allow list", "error");
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [envId]);

  useEffect(() => {
    if (open && envId) {
      load();
      setTab("allowlist");
      setCheckResult(null);
      setCheckEmail("");
      setCheckIp("");
    }
  }, [open, envId, load]);

  // Esc closes, matching every other dismissible surface in the console.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filteredRules = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rules;
    return rules.filter(
      (r) => r.value.includes(needle) || (r.label || "").toLowerCase().includes(needle),
    );
  }, [rules, search]);

  const enabledCount = rules.filter((r) => r.is_enabled).length;

  const afterWrite = useCallback(async () => {
    await load();
    onChanged?.();
  }, [load, onChanged]);

  const toggleEnabled = async (rule: AccessRule) => {
    const next = !rule.is_enabled;
    setRules((rows) => rows.map((r) => (r.id === rule.id ? { ...r, is_enabled: next } : r)));
    try {
      await updateRule(rule.id, { is_enabled: next });
      toast(
        next ? `${rule.value} can be used again` : `${rule.value} is switched off`,
        next ? "success" : "warning",
      );
      onChanged?.();
    } catch (err: any) {
      setRules((rows) => rows.map((r) => (r.id === rule.id ? { ...r, is_enabled: !next } : r)));
      toast(err?.message || "Could not change the switch", "error");
    }
  };

  const removeRule = async (rule: AccessRule) => {
    const ok = await confirmDanger({
      title: "Remove from allow list?",
      html: `<strong>${escHtml(
        rule.rule_type === "domain" ? "@" + rule.value : rule.value,
      )}</strong> will no longer grant access to <strong>${escHtml(envName || "")}</strong>.`,
      confirmText: "Remove",
    });
    if (!ok) return;

    try {
      await deleteRule(rule.id);
      toast("Removed from the allow list", "success");
      await afterWrite();
    } catch (err: any) {
      toast(err?.message || "Could not remove the entry", "error");
    }
  };

  const openAdd = () => {
    setAddType("email");
    setAddValue("");
    setAddLabel("");
    setAddTypeTouched(false);
    setAddOpen(true);
  };

  const onAddValueChange = (value: string) => {
    setAddValue(value);
    if (!addTypeTouched) setAddType(inferRuleType(value));
  };

  const submitAdd = async () => {
    const value = addValue.trim();
    if (!value) {
      toast(`Enter ${addType === "ip" ? "an IP address" : "a value"} first`, "warning");
      return;
    }
    if (!envId) return;

    setSaving(true);
    try {
      await createRule({
        env_id: envId,
        rule_type: addType,
        value,
        label: addLabel.trim() || null,
      });
      toast(`Added to the allow list`, "success");
      setAddOpen(false);
      await afterWrite();
    } catch (err: any) {
      toast(err?.message || "Could not add the entry", "error");
    } finally {
      setSaving(false);
    }
  };

  const runCheck = async () => {
    if (!envId) return;
    if (!checkEmail.trim() && !checkIp.trim()) {
      toast("Enter an email, a domain's email, or an IP to check", "warning");
      return;
    }
    setCheckBusy(true);
    try {
      setCheckResult(await checkAccess(envId, checkEmail.trim(), checkIp.trim()));
    } catch (err: any) {
      toast(err?.message || "Could not run the check", "error");
      setCheckResult(null);
    } finally {
      setCheckBusy(false);
    }
  };

  return (
    <div
      className={`ea-scrim${open ? " open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="ea-drawer" role="dialog" aria-modal="true" aria-label="Environment API access">
        <header className="ea-head">
          <div className="ea-head-title">
            <span className="ea-head-icon" aria-hidden="true">
              <i className="fa-solid fa-shield-halved" />
            </span>
            <div>
              <div className="ea-head-name">API Access Scope</div>
              <div className="ea-head-env">{envName || "—"}</div>
            </div>
          </div>
          <button type="button" className="ea-close" aria-label="Close" onClick={onClose}>
            <i className="fa-solid fa-xmark" />
          </button>
        </header>

        <div className="ea-body">
          <div className="ea-explainer">
            <i className="fa-solid fa-circle-info" aria-hidden="true" />
            <span>
              A caller is let through if their email, their email&apos;s domain, or their IP
              matches <strong>any</strong> active entry below. No match means no access.
            </span>
          </div>

          <div className="ea-switches">
            <div className="ea-switch-card">
              <div className="ea-switch-info">
                <div className="ea-switch-title">Email / domain / IP allow list</div>
                <div className="ea-switch-desc">Blocks unlisted callers.</div>
              </div>
              <label
                className="toggle-wrap"
                title={
                  environment?.allowlist_check_enabled
                    ? "Switch off to let every caller through this gate"
                    : "Switch on to require an allow-list match"
                }
              >
                <input
                  type="checkbox"
                  checked={!!environment?.allowlist_check_enabled}
                  disabled={!environment || switchBusy !== null}
                  aria-label="Allow-list check"
                  onChange={(e) =>
                    toggleSwitch("allowlist_check_enabled", e.target.checked)
                  }
                />
                <div className="toggle-track" />
              </label>
            </div>

            <div className="ea-switch-card">
              <div className="ea-switch-info">
                <div className="ea-switch-title">Xtend API custom field</div>
                <div className="ea-switch-desc">Checks a Wrike profile field.</div>
              </div>
              <label className="toggle-wrap" title="Reserved for the upcoming custom-field check">
                <input
                  type="checkbox"
                  checked={!!environment?.custom_field_check_enabled}
                  disabled={!environment || switchBusy !== null}
                  aria-label="Custom field check (phase 2)"
                  onChange={(e) =>
                    toggleSwitch("custom_field_check_enabled", e.target.checked)
                  }
                />
                <div className="toggle-track" />
              </label>
            </div>
          </div>

          <div className="ea-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "allowlist"}
              className="ea-tab"
              onClick={() => setTab("allowlist")}
            >
              <i className="fa-solid fa-list-check" aria-hidden="true" />
              Allow list
              <span className="ea-tab-count">{enabledCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "check"}
              className="ea-tab"
              onClick={() => setTab("check")}
            >
              <i className="fa-solid fa-vial-circle-check" aria-hidden="true" />
              Check
            </button>
          </div>

          {tab === "allowlist" && (
            <div className="ea-panel">
              <div className="ea-toolbar">
                <div className="ea-search">
                  <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                  <input
                    type="search"
                    value={search}
                    placeholder="Search…"
                    aria-label="Search the allow list"
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
                  <i className="fa-solid fa-plus" aria-hidden="true" />
                  &nbsp;Add entry
                </button>
              </div>

              <div className="ea-table-card">
                <div className="ea-scroll">
                  <table className="ea-table">
                    <thead>
                      <tr>
                        <th scope="col">Value</th>
                        <th scope="col">Type</th>
                        <th scope="col">Switch</th>
                        <th scope="col" className="ea-col-actions">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading &&
                        Array.from({ length: 4 }).map((_, i) => (
                          <tr className="ea-skeleton-row" key={i}>
                            <td colSpan={4}>
                              <div className="ea-skeleton" />
                            </td>
                          </tr>
                        ))}

                      {!loading &&
                        filteredRules.map((rule, index) => (
                          <tr
                            key={rule.id}
                            className="ea-row-in"
                            style={{ "--row-index": Math.min(index, 12) } as React.CSSProperties}
                          >
                            <td>
                              <div className="ea-identity">
                                <span className="ea-identity-icon" aria-hidden="true">
                                  <i className={`fa-solid ${TYPE_ICON[rule.rule_type]}`} />
                                </span>
                                <div className="ea-identity-main">
                                  <div className="ea-identity-value">
                                    {rule.rule_type === "domain" ? `@${rule.value}` : rule.value}
                                  </div>
                                  {rule.label && <div className="ea-identity-sub">{rule.label}</div>}
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="ea-type-badge">{ruleTypeLabel(rule.rule_type)}</span>
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
                                  aria-label={`Access via ${rule.value}`}
                                  onChange={() => toggleEnabled(rule)}
                                />
                                <div className="toggle-track" />
                              </label>
                            </td>
                            <td className="ea-col-actions">
                              <button
                                type="button"
                                className="ea-icon-btn ea-danger"
                                title="Remove entry"
                                aria-label={`Remove ${rule.value}`}
                                onClick={() => removeRule(rule)}
                              >
                                <i className="fa-solid fa-trash" />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                {!loading && rules.length === 0 && (
                  <div className="ea-empty">
                    <div className="ea-empty-icon" aria-hidden="true">
                      <i className="fa-solid fa-shield-halved" />
                    </div>
                    <div className="ea-empty-title">Nobody can call this environment yet</div>
                    <div className="ea-empty-desc">
                      Until an entry is added here, every API and MCP request to{" "}
                      {envName || "this environment"} is refused. Add an email, a whole company
                      domain, or an office IP range to get started.
                    </div>
                    <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
                      <i className="fa-solid fa-plus" aria-hidden="true" />
                      &nbsp;Add the first entry
                    </button>
                  </div>
                )}

                {!loading && rules.length > 0 && filteredRules.length === 0 && (
                  <div className="ea-empty">
                    <div className="ea-empty-icon" aria-hidden="true">
                      <i className="fa-solid fa-magnifying-glass" />
                    </div>
                    <div className="ea-empty-title">Nothing matches that search</div>
                    <div className="ea-empty-desc">No entry contains “{search}”.</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "check" && (
            <div className="ea-panel">
              <div className="ea-check-form">
                <div className="ea-check-fields">
                  <div className="form-group">
                    <label className="form-label" htmlFor="ea-check-email">
                      Email
                    </label>
                    <input
                      id="ea-check-email"
                      className="form-control"
                      type="email"
                      autoComplete="off"
                      placeholder="person@company.com"
                      value={checkEmail}
                      onChange={(e) => setCheckEmail(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="ea-check-ip">
                      IP address
                    </label>
                    <input
                      id="ea-check-ip"
                      className="form-control"
                      type="text"
                      autoComplete="off"
                      placeholder="203.0.113.4"
                      value={checkIp}
                      onChange={(e) => setCheckIp(e.target.value)}
                    />
                  </div>
                </div>
                <p className="ea-check-hint">
                  Fill in either or both. The check runs the exact same match-any rule real
                  requests do.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={checkBusy}
                  onClick={runCheck}
                  style={{ width: "100%" }}
                >
                  <i
                    className={`fa-solid ${checkBusy ? "fa-spinner fa-spin" : "fa-play"}`}
                    aria-hidden="true"
                  />
                  &nbsp;{checkBusy ? "Checking…" : "Run the check"}
                </button>
              </div>

              {checkResult && (
                <div
                  className={`ea-verdict ${checkResult.allowed ? "ea-verdict-allow" : "ea-verdict-deny"}`}
                >
                  <div className="ea-verdict-icon">
                    <i
                      className={`fa-solid ${checkResult.allowed ? "fa-circle-check" : "fa-circle-xmark"}`}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="ea-verdict-body">
                    <div className="ea-verdict-title">
                      {checkResult.allowed ? "Would be let through" : "Would be refused"}
                    </div>
                    <div className="ea-verdict-detail">{checkResult.checks[0]?.detail}</div>
                    {checkResult.matchedRule && (
                      <div className="ea-verdict-match">
                        Matched {ruleTypeLabel(checkResult.matchedRule.rule_type).toLowerCase()}{" "}
                        rule{" "}
                        <strong>
                          {checkResult.matchedRule.rule_type === "domain"
                            ? `@${checkResult.matchedRule.value}`
                            : checkResult.matchedRule.value}
                        </strong>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Add entry modal ── */}
        <div className={`modal-backdrop${addOpen ? " open" : ""}`}>
          <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <div className="modal-title">
                <i className="fa-solid fa-plus" />
                Add to allow list
              </div>
              <button className="modal-close" onClick={() => setAddOpen(false)}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <div className="modal-body">
              <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <div className="ea-type-picker">
                    {(["email", "domain", "ip"] as RuleType[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className="ea-type-option"
                        aria-pressed={addType === t}
                        onClick={() => {
                          setAddType(t);
                          setAddTypeTouched(true);
                        }}
                      >
                        <i className={`fa-solid ${TYPE_ICON[t]}`} aria-hidden="true" />
                        {ruleTypeLabel(t)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <div className="ea-value-label-row">
                    <label className="form-label" htmlFor="ea-add-value">
                      {ruleTypeLabel(addType)}
                    </label>
                    {addType === "ip" && (
                      <button
                        type="button"
                        className="ea-use-my-ip"
                        disabled={fillingMyIp}
                        onClick={useMyIp}
                      >
                        <i
                          className={`fa-solid ${fillingMyIp ? "fa-spinner fa-spin" : "fa-location-crosshairs"}`}
                          aria-hidden="true"
                        />
                        Use my IP
                      </button>
                    )}
                  </div>
                  <input
                    id="ea-add-value"
                    className="form-control"
                    type="text"
                    placeholder={TYPE_PLACEHOLDER[addType]}
                    value={addValue}
                    onChange={(e) => onAddValueChange(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="ea-add-label">
                    Note <span style={{ color: "var(--text-muted)" }}>(optional)</span>
                  </label>
                  <input
                    id="ea-add-label"
                    className="form-control"
                    type="text"
                    placeholder="e.g. Marketing ops team"
                    value={addLabel}
                    onChange={(e) => setAddLabel(e.target.value)}
                  />
                </div>
              </form>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={saving} onClick={submitAdd}>
                <i className={`fa-solid ${saving ? "fa-spinner fa-spin" : "fa-check"}`} aria-hidden="true" />
                &nbsp;Add entry
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
