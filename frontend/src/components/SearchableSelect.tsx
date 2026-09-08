import { useEffect, useRef, useState } from "react";
import "./SearchableSelect.css";

interface SearchableSelectProps {
  id?: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

// Small dependency-free searchable combobox - this app deliberately has no
// UI/component library (see frontend/package.json), so this is a minimal
// accessible replacement for a plain <select>, styled to match the existing
// .env-select look shared with the MCP OAuth picker (src/routes/oauth/index.js
// renderEnvironmentPicker) rather than introducing a divergent visual style.
export default function SearchableSelect({
  id,
  options,
  value,
  onChange,
  disabled,
  placeholder = "Search…",
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = options.filter((opt) =>
    opt.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const commit = (option: string) => {
    onChange(option);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[highlighted]) commit(filtered[highlighted]);
      else setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    }
  };

  return (
    <div className="searchable-select" ref={rootRef}>
      <button
        type="button"
        id={id}
        className="searchable-select-trigger"
        disabled={disabled}
        onClick={() => {
          setOpen((v) => !v);
          setHighlighted(0);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={value ? "" : "searchable-select-placeholder"}>
          {value || "Select an environment"}
        </span>
        <svg
          className={`searchable-select-caret${open ? " open" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="searchable-select-panel" role="listbox">
          <input
            ref={inputRef}
            type="text"
            className="searchable-select-search"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlighted(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <div className="searchable-select-options">
            {filtered.length === 0 && (
              <div className="searchable-select-empty">No matches</div>
            )}
            {filtered.map((opt, i) => (
              <div
                key={opt}
                role="option"
                aria-selected={opt === value}
                className={`searchable-select-option${i === highlighted ? " highlighted" : ""}${opt === value ? " selected" : ""}`}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => commit(opt)}
              >
                {opt}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
