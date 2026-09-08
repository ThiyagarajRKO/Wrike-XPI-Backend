import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  APPLIES_TO_OPTIONS,
  appliesToLabel,
  checkAccess,
  createRule,
  deleteRule,
  getMyIp,
  inferRuleType,
  listRules,
  ruleTypeLabel,
  updateRule,
  type AccessRule,
  type AppliesTo,
  type CheckResult,
  type RuleType,
  type Surface,
} from "../lib/environmentAccessApi";
import { toggleEnvironmentStatus, type AdminEnvironment } from "../lib/adminApi";
import { confirmDanger, escHtml, toast } from "../lib/notify";
import "./EnvironmentAccess.css";

type TabId = "allowlist" | "check";

/** Rows per page in the allow list. Small enough that the drawer never grows
    a second scrollbar of its own on a laptop screen. */
const PAGE_SIZE = 10;

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

/**
 * Picks which surface an entry grants: the REST API, MCP, or both.
 *
 * Used inline in the table (so an entry can be retargeted in one click,
 * without opening anything) and in the add form. The three options are always
 * visible rather than hidden behind a dropdown: with only three, showing them
 * costs no more room than a select and makes the current scope readable at a
 * glance down the column.
 */
function SurfacePicker({
  value,
  onChange,
  disabled = false,
  size = "md",
  idPrefix,
}: {
  value: AppliesTo;
  onChange: (next: AppliesTo) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  idPrefix: string;
}) {
  return (
    <div
      className={`ea-surface${size === "sm" ? " ea-surface-sm" : ""}`}
      role="radiogroup"
      aria-label="Applies to"
    >
      {APPLIES_TO_OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            id={`${idPrefix}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={active}
            className={`ea-surface-opt${active ? " active" : ""}`}
            disabled={disabled}
            title={option.hint}
            onClick={() => !active && onChange(option.value)}
          >
            {size === "sm" ? appliesToLabel(option.value) : option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One labelled row of filter chips. Generic over the value so each group
 * keeps its own union type rather than degrading to string, which is what
 * stops a "Status" chip being handed to the type filter by mistake.
 */
function FilterGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  onClear,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
  /** First option's value doubles as "all"/unset — pass it to enable the
      group's own individual clear button, shown only once it is active. */
  onClear?: () => void;
}) {
  const isAll = value === options[0]?.value;
  return (
    <div className="ea-filter-group">
      <div className="ea-filter-group-head">
        <span className="ea-filter-label">{label}</span>
        {onClear && !isAll && (
          <button type="button" className="ea-filter-group-clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      <div className="ea-filter-chips" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            className={`ea-filter-chip${value === option.value ? " active" : ""}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The funnel button + its popover panel. Anchored inline in the toolbar
 * (not a portal): the toolbar does not scroll independently of the popover,
 * so a simple absolutely-positioned panel is enough, unlike the per-row
 * RowMenu which does need a portal to escape a scrolling table.
 */
function FilterPopover({
  count,
  onClearAll,
  children,
}: {
  /** Number of active (non-default) filters, shown as a badge on the button. */
  count: number;
  onClearAll: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Capture phase, and stopped here: without this, the same Escape
      // keystroke would also reach the drawer's own Escape handler and close
      // the whole drawer behind the popover in one press.
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div className="ea-filter-pop-root" ref={rootRef}>
      <button
        type="button"
        className={`ea-filter-trigger${count > 0 ? " active" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Filter the allow list"
        onClick={() => setOpen((v) => !v)}
      >
        <i className="fa-solid fa-filter" aria-hidden="true" />
        <span className="ea-sr-only">
          Filter{count > 0 ? ` (${count} active)` : ""}
        </span>
        {count > 0 && <span className="ea-filter-trigger-badge">{count}</span>}
      </button>

      {open && (
        <div className="ea-filter-pop" role="dialog" aria-label="Filter the allow list">
          <div className="ea-filter-pop-header">
            <span>Filters</span>
            <button
              type="button"
              className="ea-filter-pop-close"
              aria-label="Close filters"
              onClick={() => setOpen(false)}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>

          <div className="ea-filter-pop-body">{children}</div>

          <div className="ea-filter-pop-footer">
            <button
              type="button"
              className="ea-filter-pop-clear-all"
              disabled={count === 0}
              onClick={onClearAll}
            >
              <i className="fa-solid fa-arrow-rotate-left" aria-hidden="true" />
              &nbsp;Clear all
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

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
  /* Starts true, and the fetch is kicked off by an effect that runs after the
     first paint. Without this the drawer renders one frame with an empty list
     and no request in flight, which flashes the "nobody can call this
     environment" empty state at an admin whose list is not actually empty. */
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [typeFilter, setTypeFilter] = useState<RuleType | "all">("all");
  const [scopeFilter, setScopeFilter] = useState<AppliesTo | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "on" | "off">("all");
  const [page, setPage] = useState(1);

  // Any change to what is being filtered starts again from the first page,
  // otherwise narrowing a list while on page 4 lands on an empty view.
  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, scopeFilter, statusFilter]);

  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<RuleType>("email");
  const [addValue, setAddValue] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addAppliesTo, setAddAppliesTo] = useState<AppliesTo>("both");
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
  // Which surface the simulator pretends the call arrived on. An entry scoped
  // to the other surface will correctly fail here, which is the point.
  const [checkSurface, setCheckSurface] = useState<Surface>("api");
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);

  const load = useCallback(async () => {
    if (!envId) {
      setLoading(false);
      return;
    }
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
      // Reopening on a different environment should not inherit the last
      // one's filters, which would hide entries that are actually there.
      setSearch("");
      setTypeFilter("all");
      setScopeFilter("all");
      setStatusFilter("all");
      setPage(1);
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

  /* Search plus the three filter dimensions the table actually shows, so what
     an admin can narrow by is exactly what they can see in a column. */
  const filteredRules = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rules.filter((r) => {
      if (typeFilter !== "all" && r.rule_type !== typeFilter) return false;
      if (scopeFilter !== "all" && r.applies_to !== scopeFilter) return false;
      if (statusFilter === "on" && !r.is_enabled) return false;
      if (statusFilter === "off" && r.is_enabled) return false;
      if (!needle) return true;
      return (
        r.value.toLowerCase().includes(needle) ||
        (r.label || "").toLowerCase().includes(needle)
      );
    });
  }, [rules, search, typeFilter, scopeFilter, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredRules.length / PAGE_SIZE));
  // Clamped during render rather than corrected from an effect: deleting the
  // last entry on the last page would otherwise paint an empty page for a
  // frame before the effect pulled it back.
  const safePage = Math.min(page, pageCount);

  const pagedRules = useMemo(
    () => filteredRules.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredRules, safePage],
  );

  // How many of the three popover filters are set away from "all" — the
  // badge on the funnel button. Search has its own visible box and is not
  // counted here, so the badge reflects only what is hidden inside the popup.
  const activeFilterCount =
    (typeFilter !== "all" ? 1 : 0) +
    (scopeFilter !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0);

  const clearFilters = () => {
    setTypeFilter("all");
    setScopeFilter("all");
    setStatusFilter("all");
    setSearch("");
    setPage(1);
  };

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
    setAddAppliesTo("both");
    setAddTypeTouched(false);
    setAddOpen(true);
  };

  /* Retarget one entry between API, MCP and both, straight from the table.
     Optimistic, and rolled back if the write fails, matching how the
     enable/disable switch on the same row behaves. */
  const changeAppliesTo = async (rule: AccessRule, next: AppliesTo) => {
    const previous = rule.applies_to;
    setRules((rows) => rows.map((r) => (r.id === rule.id ? { ...r, applies_to: next } : r)));
    try {
      await updateRule(rule.id, { applies_to: next });
      toast(`${rule.value} now applies to ${appliesToLabel(next)}`, "success");
    } catch (err: any) {
      setRules((rows) => rows.map((r) => (r.id === rule.id ? { ...r, applies_to: previous } : r)));
      toast(err?.message || "Could not change where this entry applies", "error");
    }
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
        applies_to: addAppliesTo,
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
      setCheckResult(
        await checkAccess(envId, checkEmail.trim(), checkIp.trim(), checkSurface),
      );
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

                <FilterPopover count={activeFilterCount} onClearAll={clearFilters}>
                  <FilterGroup
                    label="Type"
                    value={typeFilter}
                    onChange={setTypeFilter}
                    onClear={() => setTypeFilter("all")}
                    options={[
                      { value: "all", label: "All" },
                      { value: "email", label: "Email" },
                      { value: "domain", label: "Domain" },
                      { value: "ip", label: "IP" },
                    ]}
                  />
                  <FilterGroup
                    label="Applies to"
                    value={scopeFilter}
                    onChange={setScopeFilter}
                    onClear={() => setScopeFilter("all")}
                    options={[
                      { value: "all", label: "All" },
                      { value: "both", label: "API + MCP" },
                      { value: "api", label: "API" },
                      { value: "mcp", label: "MCP" },
                    ]}
                  />
                  <FilterGroup
                    label="Status"
                    value={statusFilter}
                    onChange={setStatusFilter}
                    onClear={() => setStatusFilter("all")}
                    options={[
                      { value: "all", label: "All" },
                      { value: "on", label: "On" },
                      { value: "off", label: "Off" },
                    ]}
                  />
                </FilterPopover>

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
                        <th scope="col">Applies to</th>
                        <th scope="col">Switch</th>
                        <th scope="col" className="ea-col-actions">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Skeleton mirrors the real row shape (icon + two
                          lines, then a chip per column) so the table does not
                          visibly reflow when the data lands. */}
                      {loading &&
                        Array.from({ length: 5 }).map((_, i) => (
                          <tr className="ea-skeleton-row" key={i}>
                            <td>
                              <div className="ea-skeleton-identity">
                                <div className="ea-skeleton ea-skeleton-avatar" />
                                <div className="ea-skeleton-lines">
                                  <div className="ea-skeleton" style={{ width: `${58 + (i % 3) * 12}%` }} />
                                  <div className="ea-skeleton ea-skeleton-sub" style={{ width: "34%" }} />
                                </div>
                              </div>
                            </td>
                            <td>
                              <div className="ea-skeleton ea-skeleton-chip" />
                            </td>
                            <td>
                              <div className="ea-skeleton ea-skeleton-seg" />
                            </td>
                            <td>
                              <div className="ea-skeleton ea-skeleton-switch" />
                            </td>
                            <td className="ea-col-actions">
                              <div className="ea-skeleton ea-skeleton-btn" />
                            </td>
                          </tr>
                        ))}

                      {!loading &&
                        pagedRules.map((rule, index) => (
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
                              <SurfacePicker
                                size="sm"
                                idPrefix={`surface-${rule.id}`}
                                value={rule.applies_to}
                                onChange={(next) => changeAppliesTo(rule, next)}
                                disabled={!rule.is_enabled}
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
                    <div className="ea-empty-title">Nothing matches</div>
                    <div className="ea-empty-desc">
                      No entry matches the filters you have set. Try clearing them to see all{" "}
                      {rules.length} entries.
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
                      <i className="fa-solid fa-xmark" aria-hidden="true" />
                      &nbsp;Clear filters
                    </button>
                  </div>
                )}

                {!loading && filteredRules.length > 0 && (
                  <div className="ea-pager">
                    <div className="ea-pager-count">
                      Showing {(safePage - 1) * PAGE_SIZE + 1} to{" "}
                      {Math.min(safePage * PAGE_SIZE, filteredRules.length)} of{" "}
                      {filteredRules.length}
                      {filteredRules.length !== rules.length && (
                        <span className="ea-pager-total"> (filtered from {rules.length})</span>
                      )}
                    </div>

                    {pageCount > 1 && (
                      <div className="ea-pager-nav">
                        <button
                          type="button"
                          onClick={() => setPage(safePage - 1)}
                          disabled={safePage <= 1}
                          aria-label="Previous page"
                        >
                          <i className="fa-solid fa-chevron-left" aria-hidden="true" />
                        </button>
                        <span className="ea-pager-status">
                          Page {safePage} of {pageCount}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPage(safePage + 1)}
                          disabled={safePage >= pageCount}
                          aria-label="Next page"
                        >
                          <i className="fa-solid fa-chevron-right" aria-hidden="true" />
                        </button>
                      </div>
                    )}
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
                <div className="form-group">
                  <label className="form-label">Calling as</label>
                  <div className="ea-surface" role="radiogroup" aria-label="Calling as">
                    {(["api", "mcp"] as Surface[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={checkSurface === s}
                        className={`ea-surface-opt${checkSurface === s ? " active" : ""}`}
                        onClick={() => {
                          setCheckSurface(s);
                          setCheckResult(null);
                        }}
                      >
                        <i
                          className={`fa-solid ${s === "api" ? "fa-code" : "fa-robot"}`}
                          aria-hidden="true"
                        />
                        &nbsp;{s === "api" ? "REST API" : "MCP"}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="ea-check-hint">
                  Fill in either or both. The check runs the exact same match-any rule real
                  requests do, for the surface you picked. An entry scoped to the other
                  surface will not count.
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
                      {checkResult.allowed ? "Would be let through" : "Would be refused"} on{" "}
                      {checkSurface === "api" ? "the REST API" : "MCP"}
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
                        </strong>{" "}
                        <span className="ea-verdict-scope">
                          ({appliesToLabel(checkResult.matchedRule.applies_to)})
                        </span>
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
                  <label className="form-label" id="ea-add-applies-label">
                    Applies to
                  </label>
                  <SurfacePicker
                    idPrefix="ea-add-applies"
                    value={addAppliesTo}
                    onChange={setAddAppliesTo}
                  />
                  <div className="ea-field-hint">
                    {addAppliesTo === "both"
                      ? "This entry grants access to both the REST API and MCP."
                      : addAppliesTo === "api"
                        ? "REST API calls only. MCP agents using this identity are denied."
                        : "MCP agents only. REST API calls using this identity are denied."}
                  </div>
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
