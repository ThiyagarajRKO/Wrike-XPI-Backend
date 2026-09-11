import { getPortalToken } from "../lib/portalAuthApi";
import EnvironmentAccess from "./EnvironmentAccess";

/**
 * The portal's environment API access scope, opened from an environment row's
 * "API Access Scope" action.
 *
 * It is the same <EnvironmentAccess /> drawer the admin console opens — same
 * allow list, filters, search and Check simulator — differing in exactly the
 * two ways the portal requires:
 *
 *   · transport { surface: "portal" } → /api/v1/portal/environment-access/*
 *     (src/routes/portal/environmentAccess/index.js), which scopes every call
 *     to environments the caller owns and is gated by
 *     requirePortalPermission("environment_access", "read").
 *
 *   · canWrite={false} → every write affordance is hidden (both gate
 *     switches, Add entry, the applies-to picker, the per-row enable toggle,
 *     Remove) — each one shown only when the matrix grants the action that
 *     route needs: create adds an entry, update edits/re-enables one or
 *     flips a security switch, delete removes one
 *     (src/routes/portal/environmentAccess/index.js). A user with read alone
 *     sees the list, the filters, search and the Check simulator and no
 *     write control at all.
 *
 * Kept as its own component rather than inline in PortalHome so the
 * portal-specific decisions (which surface to call, which grants map to which
 * affordance) live in one place that every caller shares.
 */
export default function PortalEnvironmentAccess({
  envId,
  envName,
  environment,
  open,
  onClose,
  onChanged,
  canCreate,
  canUpdate,
  canDelete,
}: {
  envId: string | null;
  envName: string | null;
  /** The two gate flags off the environment record — PortalEnvironmentFull
      carries both, so the switches render in their real state. */
  environment: {
    allowlist_check_enabled: boolean;
    custom_field_check_enabled: boolean;
  } | null;
  open: boolean;
  onClose: () => void;
  /** Called after a successful write. The two gate switches are controlled by
      the `environment` record above, so without this the drawer would keep
      rendering the value it was opened with — the write would succeed and the
      switch would not move. The admin console passes its environments reload
      here; the portal passes its own (see PortalHome). */
  onChanged?: () => void;
  /** environment_access:create / update / delete from the caller's matrix. */
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  return (
    <EnvironmentAccess
      envId={envId}
      envName={envName}
      environment={environment}
      open={open}
      onClose={onClose}
      onChanged={onChanged}
      canCreate={canCreate}
      canUpdate={canUpdate}
      canDelete={canDelete}
      transport={{ surface: "portal", token: getPortalToken() }}
    />
  );
}
