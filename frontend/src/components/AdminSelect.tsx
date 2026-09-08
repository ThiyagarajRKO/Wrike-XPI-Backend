import { useEffect, useRef, useState } from "react";
import "./AdminSelect.css";

export interface AdminSelectOption {
  value: string;
  label: string;
}

interface AdminSelectProps {
  id?: string;
  icon?: string;
  options: AdminSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  ariaLabel?: string;
  /** Hide the search box for genuinely short lists (a handful of fixed
      options) where typing to filter adds a step rather than saving one.
      Defaults on — most lists here (environments) grow over time. */
  searchable?: boolean;
}

/**
 * A dropdown styled to the admin shell's own tokens (accent/card/border),
 * not a native <select>. The native element's own option list can't be
 * restyled in any browser — its font, spacing and colours come straight
 * from the OS, which is exactly why a plain <select> reads as un-designed
 * next to everything else on the page. This renders its own panel instead,
 * so it's the same visual system as every other control here — search
 * included, once a list is long enough that scanning beats scrolling.
 *
 * frontend/src/components/SearchableSelect.tsx already solves the same
 * interaction problem, but it's styled for the dark glass login hero — a
 * white-on-white mismatch on this shell — so this is a sibling for the
 * light app-shell context rather than a retrofit of that one.
 */
export default function AdminSelect({
  id,
  icon,
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  ariaLabel,
  searchable = true,
}: AdminSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = searchable
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      const i = options.findIndex((o) => o.value === value);
      setHighlighted(i >= 0 ? i : 0);
      if (searchable) requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Typing narrows the list — keep the highlight on a row that still matches
  // rather than pointing at whatever used to be in that position.
  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlighted]) commit(filtered[highlighted].value);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    }
  };

  // Once open and searchable, the search input owns key handling (focus
  // moves there). Otherwise the trigger button stays focused throughout, so
  // it has to handle both "open the panel" and "navigate inside it" itself.
  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (!searchable) onListKeyDown(e);
  };

  return (
    <div className="adsel" ref={rootRef}>
      <button
        type="button"
        id={id}
        className="adsel-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        {icon && <i className={`fa-solid ${icon} adsel-icon`} aria-hidden="true" />}
        <span className={`adsel-value${selected ? "" : " adsel-placeholder"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <i className={`fa-solid fa-chevron-down adsel-caret${open ? " open" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="adsel-panel">
          {searchable && (
            <input
              ref={searchRef}
              type="text"
              className="adsel-search"
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onListKeyDown}
            />
          )}
          <div className="adsel-options" role="listbox">
            {filtered.length === 0 && <div className="adsel-empty">No matches</div>}
            {filtered.map((opt, i) => (
              <div
                key={opt.value || "__empty"}
                role="option"
                aria-selected={opt.value === value}
                className={`adsel-option${i === highlighted ? " highlighted" : ""}${
                  opt.value === value ? " selected" : ""
                }`}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => commit(opt.value)}
              >
                {opt.value === value && <i className="fa-solid fa-check" aria-hidden="true" />}
                {opt.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
