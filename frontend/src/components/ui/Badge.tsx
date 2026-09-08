import type { ReactNode } from "react";

/* Status pills. Replaces badgeHtml() / puStatusBadge() / puRoleBadge(), which
 * each returned a hand-built HTML string with inline styles baked in. */

export type BadgeTone = "success" | "danger" | "warning" | "info" | "neutral";

export function Badge({
  tone = "neutral",
  icon,
  dot = false,
  children,
}: {
  tone?: BadgeTone;
  /** FontAwesome classes, e.g. "fa-solid fa-shield-halved". */
  icon?: string;
  /** Show the small status dot instead of an icon. */
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="dot" />}
      {icon && <i className={icon} aria-hidden="true" />}
      {children}
    </span>
  );
}

export const ActiveBadge = ({ active }: { active: boolean }) => (
  <Badge tone={active ? "success" : "danger"} dot>
    {active ? "Active" : "Inactive"}
  </Badge>
);
