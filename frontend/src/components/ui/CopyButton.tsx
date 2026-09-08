import { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "../../lib/format";

/* Copy-to-clipboard icon button with a "copied" tick.
 *
 * The old table rows shipped a bare <button class="copy-id-btn" data-id="…">
 * and a delegated jQuery handler that swapped FontAwesome classes by hand.
 * Here the tick is state, and the reset timer is cleared on unmount so a row
 * that is deleted or paginated away mid-timeout can't set state afterwards. */

export function CopyButton({
  value,
  title = "Copy",
  className = "icon-btn",
}: {
  value: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <button
      type="button"
      className={`${className}${copied ? " copied" : ""}`}
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!value) return;
        copyToClipboard(value).then(() => {
          setCopied(true);
          if (timerRef.current) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <i className={`fa-solid ${copied ? "fa-check" : "fa-copy"}`} aria-hidden="true" />
    </button>
  );
}
