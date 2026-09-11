/**
 * The module vocabulary for portal-user permissions — what "Overview",
 * "Environments" and "Environment Access" mean, and which of the four
 * actions each one actually supports.
 *
 * Single authority: the admin console fetches this from
 * GET /api/v1/admin/portal-users/permissions/catalog instead of hard-coding a
 * second copy, so a module added here shows up in the UI with no matching
 * frontend edit — and the two can never drift apart.
 *
 * `actions` narrows what a module can express: Overview is a read-only
 * dashboard, so offering Create/Update/Delete on it would be a lie — the
 * console greys those cells out rather than rendering ticks that mean
 * nothing, and the server discards them if sent anyway.
 */

export const ACTIONS = ["read", "create", "update", "delete"];

const ALL = ["read", "create", "update", "delete"];

export const MODULES = [
  {
    key: "overview",
    label: "Overview",
    description:
      "The dashboard summary: how many environments the user has, and how many are active.",
    actions: ["read"],
  },
  {
    key: "environments",
    label: "Environments",
    description: "Wrike environment records: credentials, IDs and visibility.",
    actions: ALL,
  },
  {
    key: "environment_access",
    label: "Environment Access",
    description:
      "The email/domain/IP allow list controlling who can call the API.",
    // All four, one per portal route: read lists the allow list, create adds
    // an entry, update edits/re-enables one or flips a security switch, delete
    // removes one (src/routes/portal/environmentAccess/index.js).
    actions: ALL,
  },
  {
    key: "activity_logs",
    label: "Activity Logs",
    description:
      "The API/MCP call audit trail: who called what, and whether it was allowed.",
    actions: ["read"],
  },
  {
    key: "cache",
    label: "Cache Settings",
    description:
      "Cached Redis keys and their values — read to browse, delete to clear keys.",
    actions: ["read", "delete"],
  },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);

const moduleByKey = Object.fromEntries(MODULES.map((m) => [m.key, m]));

/** An all-false matrix — the safe starting point for a user with no rows yet. */
export const emptyMatrix = () =>
  Object.fromEntries(
    MODULES.map((m) => [
      m.key,
      { read: false, create: false, update: false, delete: false },
    ]),
  );

/**
 * Normalise arbitrary input into a full, valid matrix: every module present,
 * every action a module doesn't support forced off. Anything the caller
 * invents beyond that is discarded rather than stored.
 */
export const normaliseMatrix = (input) => {
  const result = emptyMatrix();

  for (const mod of MODULES) {
    for (const action of mod.actions) {
      result[mod.key][action] = !!input?.[mod.key]?.[action];
    }
  }

  return result;
};

export const isKnownModule = (key) => !!moduleByKey[key];

export const catalog = () => ({ actions: ACTIONS, modules: MODULES });
