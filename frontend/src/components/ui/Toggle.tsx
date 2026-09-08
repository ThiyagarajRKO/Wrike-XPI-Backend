import { useState } from "react";

/* The switch control used in table cells, the edit modal and the access
 * drawer. Matches the existing .toggle-wrap / .toggle-track styling in
 * AdminDashboard.css.
 *
 * `onToggle` returns a promise; the switch shows a spinner while it is in
 * flight and reverts if it rejects. That optimistic-then-rollback behaviour
 * used to live in a jQuery change handler that mutated checkboxEl.checked and
 * toggled a class on the wrapper by hand. */

export function Toggle({
  checked,
  onToggle,
  disabled = false,
  size = "md",
  title,
  ariaLabel,
}: {
  checked: boolean;
  onToggle: (next: boolean) => void | Promise<void>;
  disabled?: boolean;
  size?: "sm" | "md";
  title?: string;
  ariaLabel?: string;
}) {
  const [busy, setBusy] = useState(false);

  // While a write is in flight, show where the user is dragging it to, not
  // where the server still has it.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const shown = optimistic ?? checked;

  return (
    <label
      className={`toggle-wrap${size === "sm" ? " toggle-wrap-sm" : ""}${busy ? " toggle-busy" : ""}`}
      title={title}
    >
      <input
        type="checkbox"
        checked={shown}
        disabled={disabled || busy}
        aria-label={ariaLabel ?? title}
        onChange={async (e) => {
          const next = e.target.checked;
          setOptimistic(next);
          setBusy(true);
          try {
            await onToggle(next);
          } catch {
            // The caller surfaces the error; here we only undo the switch.
          } finally {
            // Drop the optimistic value either way: on success the parent's
            // `checked` prop now carries it, and on failure we fall back to
            // the unchanged prop, which reverts the switch.
            setOptimistic(null);
            setBusy(false);
          }
        }}
      />
      <div className="toggle-track" />
    </label>
  );
}
