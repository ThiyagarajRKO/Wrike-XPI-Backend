/**
 * The RBAC vocabulary for portal users: which modules exist, which actions
 * each module actually supports, and the fixed global roles that preset them.
 *
 * This file is the single authority. The admin console fetches it from
 * GET /api/v1/admin/permissions/catalog rather than hard-coding a second copy,
 * so a module added here shows up in the UI without a matching frontend edit
 * and the two can never drift.
 *
 * Two separate systems meet in the console, and they are deliberately not the
 * same thing:
 *
 *   - API access (src/utils/accessControl.js) governs *Wrike callers* hitting
 *     the REST/MCP API — matched by email or domain, gated on the Xtend API
 *     custom field. Scoped to one environment.
 *   - This file governs *portal users* — the people who sign into the portal
 *     and administer it. Module-level, scoped to the environments they own.
 *
 * The "api_access" module below is where they touch: it is the permission to
 * administer the email/domain allow list, not permission to call the API.
 */

export const ACTIONS = ["read", "create", "update", "delete"];

/**
 * `actions` narrows what a module can express. Overview is a read-only
 * dashboard, so offering Create/Update/Delete on it would be a lie — the
 * console greys those cells rather than rendering ticks that mean nothing.
 */
export const MODULES = [
  {
    key: "overview",
    label: "Overview",
    description: "Dashboard summary, counts and recent activity.",
    actions: ["read"],
  },
  {
    key: "environments",
    label: "Environments",
    description:
      "Wrike environment records — credentials, Datahub IDs and visibility.",
    actions: ["read", "create", "update", "delete"],
  },
  {
    key: "users",
    label: "User Management",
    description:
      "Portal user accounts, their environment scope and their permissions.",
    actions: ["read", "create", "update", "delete"],
  },
  {
    key: "api_access",
    label: "API Access",
    description:
      "The email/domain allow list and per-caller API permissions for an environment.",
    actions: ["read", "create", "update", "delete"],
  },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);

const moduleByKey = Object.fromEntries(MODULES.map((m) => [m.key, m]));

/** An all-false grant for every module — the safe starting point. */
export const emptyMatrix = () =>
  Object.fromEntries(
    MODULES.map((m) => [
      m.key,
      { read: false, create: false, update: false, delete: false },
    ]),
  );

/**
 * Build a matrix from a per-module action list, dropping any action the
 * module doesn't support so a role can never grant something meaningless.
 */
const matrix = (spec) => {
  const result = emptyMatrix();

  for (const [key, granted] of Object.entries(spec)) {
    const mod = moduleByKey[key];
    if (!mod) continue;
    for (const action of granted) {
      if (mod.actions.includes(action)) result[key][action] = true;
    }
  }

  return result;
};

const ALL = ["read", "create", "update", "delete"];

/**
 * Fixed, global roles: one "Viewer" means the same thing in every
 * environment, so an admin learns the vocabulary once. A role is a preset
 * over the matrix, not a stored foreign key — the matrix is what is saved, so
 * an admin can always deviate from a role and the result is labelled Custom.
 */
export const ROLES = [
  {
    key: "no_access",
    label: "No Access",
    description: "Signed in, but every module is hidden. Nothing is readable.",
    permissions: matrix({}),
  },
  {
    key: "viewer",
    label: "Viewer",
    description: "Can see everything in scope. Cannot change anything.",
    permissions: matrix({
      overview: ["read"],
      environments: ["read"],
      users: ["read"],
      api_access: ["read"],
    }),
  },
  {
    key: "contributor",
    label: "Contributor",
    description:
      "Can manage environments and the API allow list. Cannot manage people.",
    permissions: matrix({
      overview: ["read"],
      environments: ["read", "create", "update"],
      users: ["read"],
      api_access: ["read", "create", "update", "delete"],
    }),
  },
  {
    key: "administrator",
    label: "Administrator",
    description: "Full control of every module, including other users.",
    permissions: matrix({
      overview: ALL,
      environments: ALL,
      users: ALL,
      api_access: ALL,
    }),
  },
];

const roleByKey = Object.fromEntries(ROLES.map((r) => [r.key, r]));

export const roleForKey = (key) => roleByKey[key] || null;

const sameMatrix = (a, b) =>
  MODULES.every((m) =>
    ACTIONS.every((action) => !!a?.[m.key]?.[action] === !!b?.[m.key]?.[action]),
  );

/**
 * The role a matrix exactly matches, or null for a hand-tuned combination.
 * Null means "Custom" — never force-fit it to the nearest role, because a
 * permissions screen that rounds off what it shows is worse than useless.
 */
export const roleForMatrix = (permissions) => {
  const found = ROLES.find((r) => sameMatrix(r.permissions, permissions));
  return found ? found.key : null;
};

/**
 * Normalise arbitrary input into a full, valid matrix: every module present,
 * every unsupported action forced off. Anything the caller invents is
 * discarded rather than stored.
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

export const catalog = () => ({
  actions: ACTIONS,
  modules: MODULES,
  roles: ROLES,
});
