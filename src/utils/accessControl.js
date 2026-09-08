import crypto from "crypto";
import redisClient from "./redis";
import { ApiAccess } from "../controllers";
import { getUserProfileWithCustomFields, getCustomFields } from "./wrike";

require("dotenv").config();

/**
 * API / MCP authorization, evaluated immediately after token validation.
 *
 * Three gates, in order, all fail-closed:
 *
 *   1. Allow list  — the caller's Wrike email (or its domain) must match an
 *                    ENABLED rule on the environment the token belongs to.
 *   2. Xtend API   — the caller's "Xtend API" custom field on their Wrike
 *                    contact must read "Enabled".
 *   3. Permission  — the action (read/create/update/delete) must be granted,
 *                    either by the matched rule's baseline or by a per-user
 *                    override row.
 *
 * Latency is the constraint that shapes everything here. A cold evaluation is
 * two Wrike calls plus two queries; a warm one is a Map lookup with zero IO.
 * Three tiers do that work:
 *
 *   L1  in-process Map, short TTL — the steady state, sub-millisecond
 *   L2  Redis, shared across instances — survives a restart, warms new pods
 *   L3  Postgres / the Wrike API — only on a genuine miss
 *
 * Admin writes invalidate L1+L2 for the affected environment synchronously, so
 * a permission change takes effect on the very next request rather than
 * whenever a TTL happens to lapse.
 */

/* ── Configuration ─────────────────────────────────────────────────────── */

const CUSTOM_FIELD_NAME =
  process.env.ACCESS_CUSTOM_FIELD_NAME?.trim() || "Xtend API";

const ENABLED_VALUE = "enabled";

// A missing ACCESS_CONTROL_ENABLED means enforced. Only an explicit "false"
// turns the gates into audit-only logging — the safe default is the strict one.
const ENFORCED = process.env.ACCESS_CONTROL_ENABLED !== "false";

const seconds = (name, fallback) => {
  const parsed = parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const RULES_TTL = seconds("ACCESS_RULES_TTL", 300); // 5 min
const PROFILE_TTL = seconds("ACCESS_PROFILE_TTL", 300); // 5 min
const FIELD_TTL = seconds("ACCESS_FIELD_TTL", 3600); // 1 hr
const L1_TTL_MS = seconds("ACCESS_MEMORY_TTL", 30) * 1000; // 30 s

export const ACTIONS = ["read", "create", "update", "delete"];

const METHOD_ACTIONS = {
  GET: "read",
  HEAD: "read",
  OPTIONS: "read",
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};

/* ── L1: in-process cache ──────────────────────────────────────────────── */

const memory = new Map();

const memoryGet = (key) => {
  const hit = memory.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    memory.delete(key);
    return undefined;
  }
  return hit.value;
};

const memorySet = (key, value, ttlMs = L1_TTL_MS) => {
  memory.set(key, { value, expiresAt: Date.now() + ttlMs });
};

const memoryDeletePrefix = (prefix) => {
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
};

/**
 * Read through L1 → L2 → loader, writing back to both on the way out.
 * Redis being down is not an error here: redisClient already degrades to
 * null, so the request falls through to the loader and still succeeds.
 */
const cached = async (key, ttlSeconds, loader) => {
  const local = memoryGet(key);
  if (local !== undefined) return local;

  const remote = await redisClient.get(key);
  if (remote !== null && remote !== undefined) {
    memorySet(key, remote);
    return remote;
  }

  const fresh = await loader();
  memorySet(key, fresh);
  redisClient.set(key, fresh, ttlSeconds).catch(() => {});

  return fresh;
};

/* ── Cache keys ────────────────────────────────────────────────────────── */

const rulesKey = (envId) => `xpi:ac:rules:${envId}`;
const permissionsKey = (envId) => `xpi:ac:perms:${envId}`;
const fieldKey = (environmentName) => `xpi:ac:field:${environmentName || "default"}`;
const profileKey = (fingerprint) => `xpi:ac:profile:${fingerprint}`;

// The token is never stored — only an opaque digest of it, so a cache dump
// can't be replayed against Wrike.
const fingerprint = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 32);

/* ── Loaders ───────────────────────────────────────────────────────────── */

/**
 * Compile an environment's rules into two lookup objects so matching a caller
 * is two property reads instead of a scan over every rule.
 */
const loadRuleIndex = async (envId) => {
  const rules = await ApiAccess.GetRulesByEnv(envId);

  const index = { emails: {}, domains: {} };

  for (const rule of rules) {
    const entry = {
      id: rule.id,
      value: rule.value,
      label: rule.label,
      rule_type: rule.rule_type,
      is_enabled: !!rule.is_enabled,
      permissions: {
        read: !!rule.can_read,
        create: !!rule.can_create,
        update: !!rule.can_update,
        delete: !!rule.can_delete,
      },
    };

    if (rule.rule_type === "domain") index.domains[rule.value] = entry;
    else index.emails[rule.value] = entry;
  }

  return index;
};

const loadPermissionIndex = async (envId) => {
  const permissions = await ApiAccess.GetPermissionsByEnv(envId);

  const index = {};
  for (const p of permissions) {
    index[p.email] = {
      id: p.id,
      display_name: p.display_name,
      permissions: {
        read: !!p.can_read,
        create: !!p.can_create,
        update: !!p.can_update,
        delete: !!p.can_delete,
      },
    };
  }

  return index;
};

/**
 * Ids of every account custom field titled "Xtend API". Plural because a Wrike
 * account can carry same-titled fields in more than one space, and the caller's
 * contact may be stamped with any of them.
 */
const loadXtendFieldIds = async (wrikeToken) => {
  try {
    const response = await getCustomFields(wrikeToken);
    const wanted = CUSTOM_FIELD_NAME.trim().toLowerCase();

    return (response?.data || [])
      .filter((field) => String(field?.title || "").trim().toLowerCase() === wanted)
      .map((field) => field.id);
  } catch (err) {
    console.error(
      new Date().toISOString(),
      `[access] custom field lookup failed: ${err?.message || err}`,
    );
    return [];
  }
};

/**
 * The caller's identity and Xtend API flag, in one shape.
 *
 * Cached against a digest of their access token. On a refresh failure we
 * deliberately fall back to a stale entry when one exists: a Wrike blip should
 * not revoke a known-good caller mid-session, and the entry was still
 * authorized by the same three gates when it was written.
 */
const loadProfile = async (wrikeToken, environmentName = null) => {
  const key = profileKey(fingerprint(wrikeToken));

  const local = memoryGet(key);
  if (local !== undefined) return local;

  const remote = await redisClient.get(key);
  if (remote && remote.cachedAt && Date.now() - remote.cachedAt < PROFILE_TTL * 1000) {
    memorySet(key, remote);
    return remote;
  }

  try {
    const [contact, fieldIds] = await Promise.all([
      getUserProfileWithCustomFields(wrikeToken),
      cached(fieldKey(environmentName), FIELD_TTL, () =>
        loadXtendFieldIds(wrikeToken),
      ),
    ]);

    const me = contact?.data?.[0];
    if (!me) throw new Error("Wrike returned no contact for this token");

    const email = String(me.primaryEmail || "").trim().toLowerCase();

    const match = (me.customFields || []).find((cf) =>
      fieldIds.includes(cf?.id),
    );

    const profile = {
      cachedAt: Date.now(),
      userId: me.id || null,
      email,
      displayName:
        [me.firstName, me.lastName].filter(Boolean).join(" ").trim() || email,
      // null distinguishes "the field isn't on this contact" from "it's set to
      // Disabled" — the console shows the admin a different fix for each.
      xtendApi: match ? String(match.value ?? "").trim() : null,
      xtendApiFieldFound: fieldIds.length > 0,
    };

    memorySet(key, profile);
    redisClient.set(key, profile, PROFILE_TTL * 4).catch(() => {});

    return profile;
  } catch (err) {
    if (remote) {
      console.warn(
        new Date().toISOString(),
        `[access] profile refresh failed, serving cached identity: ${err?.message || err}`,
      );
      memorySet(key, remote);
      return remote;
    }
    throw err;
  }
};

/* ── Invalidation ──────────────────────────────────────────────────────── */

/** Drop every cached decision input for one environment, L1 and L2. */
export const invalidateEnvironment = async (envId) => {
  if (!envId) return;

  const keys = [rulesKey(envId), permissionsKey(envId)];
  keys.forEach((key) => memory.delete(key));

  await redisClient.delMany(keys).catch(() => {});
};

/** Drop every cached identity — used after a global access-config change. */
export const invalidateProfiles = async () => {
  memoryDeletePrefix("xpi:ac:profile:");

  const keys = await redisClient.keys("xpi:ac:profile:*").catch(() => []);
  if (keys?.length) await redisClient.delMany(keys).catch(() => {});
};

/* ── Decision helpers ──────────────────────────────────────────────────── */

const domainOf = (email) => String(email || "").split("@")[1] || "";

const gate = (key, label, status, detail) => ({ key, label, status, detail });

const NO_PERMISSIONS = {
  read: false,
  create: false,
  update: false,
  delete: false,
};

export const actionForMethod = (method) =>
  METHOD_ACTIONS[String(method || "").toUpperCase()] || "read";

/**
 * Map an MCP tool name onto a CRUD action. The native XPI tools follow a
 * strict `<resource>_<verb>` convention; proxied Wrike tools (`wrike_*`) don't,
 * so their own readOnlyHint annotation is the fallback signal.
 */
const TOOL_VERBS = [
  // Ordered by severity, not by frequency: a name carrying two verbs is
  // resolved to the more dangerous one, so an ambiguous tool over-restricts
  // rather than under-restricts.
  ["delete", ["delete", "remove", "destroy", "purge", "archive"]],
  ["create", ["create", "add", "new", "upload", "submit", "duplicate"]],
  ["update", ["update", "edit", "modify", "set", "move", "assign", "rename"]],
  ["read", ["list", "get", "search", "read", "find", "query", "fields", "describe"]],
];

export const actionForTool = (toolName, annotations = {}) => {
  // The tool's own declaration wins over any guess made from its name: a tool
  // that states it cannot mutate anything only ever needs read.
  if (annotations?.readOnlyHint === true) return "read";

  // Match on underscore-delimited segments rather than substrings, so a
  // resource called "updates" is never mistaken for the verb "update", and so
  // a verb in the middle of a name ("wrike_create_task") still registers.
  const segments = new Set(String(toolName || "").toLowerCase().split(/[_\-.]+/));

  for (const [action, verbs] of TOOL_VERBS) {
    if (verbs.some((verb) => segments.has(verb))) return action;
  }

  if (annotations?.destructiveHint === true) return "delete";

  // Unrecognised tool: treat as a write. An unknown verb should need the
  // stronger grant, not the weaker one.
  return "update";
};

/* ── The evaluation ────────────────────────────────────────────────────── */

/**
 * Run all three gates for one caller against one environment.
 *
 * Always resolves — never throws — so both the request path and the admin
 * simulator can render the same structured decision.
 *
 * @param {object}  input
 * @param {string}  input.envId            Environment the token belongs to
 * @param {string}  input.wrikeToken       Caller's decrypted Wrike access token
 * @param {string}  [input.action]         read | create | update | delete
 * @param {object}  [input.knownProfile]   Pre-resolved identity (simulator path)
 * @returns {Promise<object>} decision
 */
export const evaluateAccess = async ({
  envId,
  environmentName = null,
  wrikeToken,
  action = "read",
  knownProfile = null,
}) => {
  const gates = [];

  if (!envId) {
    return {
      allowed: false,
      code: "ENVIRONMENT_UNKNOWN",
      message:
        "This token is not bound to an environment, so access rules cannot be applied.",
      permissions: NO_PERMISSIONS,
      gates: [
        gate("environment", "Environment", "fail", "Token has no environment"),
      ],
    };
  }

  /* Gate 0 — who is calling */
  let profile = knownProfile;
  if (!profile) {
    try {
      profile = await loadProfile(wrikeToken, environmentName);
    } catch (err) {
      return {
        allowed: false,
        code: "IDENTITY_UNAVAILABLE",
        message:
          "Could not verify who this token belongs to. Please retry, or reconnect the integration.",
        permissions: NO_PERMISSIONS,
        gates: [
          gate(
            "identity",
            "Identity",
            "fail",
            err?.message || "Wrike profile lookup failed",
          ),
        ],
      };
    }
  }

  const email = String(profile?.email || "").trim().toLowerCase();

  if (!email) {
    return {
      allowed: false,
      code: "IDENTITY_UNAVAILABLE",
      message: "This Wrike account has no primary email address to authorize.",
      permissions: NO_PERMISSIONS,
      gates: [gate("identity", "Identity", "fail", "No primary email")],
    };
  }

  gates.push(gate("identity", "Identity", "pass", email));

  const identity = {
    email,
    userId: profile.userId || null,
    displayName: profile.displayName || email,
  };

  /* Gate 1 — allow list (email wins over domain) */
  const [ruleIndex, permissionIndex] = await Promise.all([
    cached(rulesKey(envId), RULES_TTL, () => loadRuleIndex(envId)),
    cached(permissionsKey(envId), RULES_TTL, () => loadPermissionIndex(envId)),
  ]);

  const emailRule = ruleIndex.emails?.[email] || null;
  const domainRule = ruleIndex.domains?.[domainOf(email)] || null;
  const matchedRule = emailRule || domainRule;

  if (!matchedRule) {
    gates.push(
      gate(
        "allowlist",
        "Allow list",
        "fail",
        `Neither ${email} nor @${domainOf(email)} is on this environment's allow list`,
      ),
    );
    return {
      allowed: false,
      code: "NOT_WHITELISTED",
      message: `${email} is not approved for this environment.`,
      ...identity,
      permissions: NO_PERMISSIONS,
      gates,
    };
  }

  if (!matchedRule.is_enabled) {
    gates.push(
      gate(
        "allowlist",
        "Allow list",
        "fail",
        `Matched "${matchedRule.value}", but that entry is switched off`,
      ),
    );
    return {
      allowed: false,
      code: "ALLOWLIST_DISABLED",
      message: `Access for ${email} is switched off for this environment.`,
      ...identity,
      matchedRule,
      permissions: NO_PERMISSIONS,
      gates,
    };
  }

  gates.push(
    gate(
      "allowlist",
      "Allow list",
      "pass",
      matchedRule.rule_type === "domain"
        ? `Matched domain rule @${matchedRule.value}`
        : `Matched email rule ${matchedRule.value}`,
    ),
  );

  /* Gate 2 — the Xtend API custom field */
  const flag = String(profile?.xtendApi ?? "").trim();

  if (!flag) {
    gates.push(
      gate(
        "custom_field",
        `${CUSTOM_FIELD_NAME} field`,
        "fail",
        profile?.xtendApiFieldFound
          ? `Not set on this user's Wrike profile`
          : `No custom field named "${CUSTOM_FIELD_NAME}" exists in this Wrike account`,
      ),
    );
    return {
      allowed: false,
      code: "CUSTOM_FIELD_MISSING",
      message: `The "${CUSTOM_FIELD_NAME}" field is not set on this Wrike user.`,
      ...identity,
      matchedRule,
      permissions: NO_PERMISSIONS,
      gates,
    };
  }

  if (flag.toLowerCase() !== ENABLED_VALUE) {
    gates.push(
      gate("custom_field", `${CUSTOM_FIELD_NAME} field`, "fail", `Set to "${flag}"`),
    );
    return {
      allowed: false,
      code: "CUSTOM_FIELD_DISABLED",
      message: `The "${CUSTOM_FIELD_NAME}" field is set to "${flag}" for this Wrike user.`,
      ...identity,
      matchedRule,
      permissions: NO_PERMISSIONS,
      gates,
    };
  }

  gates.push(
    gate("custom_field", `${CUSTOM_FIELD_NAME} field`, "pass", `Set to "${flag}"`),
  );

  /* Gate 3 — the action itself */
  const override = permissionIndex?.[email] || null;
  const permissions = override ? override.permissions : matchedRule.permissions;
  const source = override ? "user_override" : "rule_baseline";

  // action === null resolves identity + grants without judging a specific
  // operation — the MCP connect path, which gates each tool call separately.
  if (!action) {
    return {
      allowed: true,
      code: "ALLOWED",
      message: "Authorized.",
      ...identity,
      matchedRule,
      source,
      permissions,
      gates,
    };
  }

  if (!permissions[action]) {
    gates.push(
      gate(
        "permission",
        "Permission",
        "fail",
        `${action} not granted (${
          source === "user_override"
            ? "per-user grant"
            : `inherited from ${matchedRule.value}`
        })`,
      ),
    );
    return {
      allowed: false,
      code: "PERMISSION_DENIED",
      message: `${email} does not have "${action}" access in this environment.`,
      ...identity,
      matchedRule,
      source,
      permissions,
      gates,
    };
  }

  gates.push(
    gate(
      "permission",
      "Permission",
      "pass",
      `${action} granted (${
        source === "user_override"
          ? "per-user grant"
          : `inherited from ${matchedRule.value}`
      })`,
    ),
  );

  return {
    allowed: true,
    code: "ALLOWED",
    message: "Authorized.",
    ...identity,
    matchedRule,
    source,
    permissions,
    gates,
  };
};

/**
 * Resolve a caller's effective permissions for an environment without checking
 * any single action — lets the MCP layer run the identity and Xtend API gates
 * once per connection and then check each tool call against a plain object.
 */
export const resolveAccessContext = ({ envId, environmentName, wrikeToken }) =>
  evaluateAccess({ envId, environmentName, wrikeToken, action: null });

/**
 * Answer "what would happen if this person called right now?" from stored
 * configuration alone — the admin console's access simulator.
 *
 * Gates 1 and 3 are ours and resolve exactly as they would on a real request,
 * against the same cached indexes. Gate 2 lives on the caller's own Wrike
 * contact and cannot be read without their token, so it is reported honestly
 * as pending rather than guessed at. Saying "this is checked live" is more
 * useful to an admin than a confident answer that might be wrong.
 */
export const simulateAccess = async ({ envId, email }) => {
  const address = String(email || "").trim().toLowerCase();

  if (!envId || !address) {
    throw { statusCode: 400, message: "Environment and email are required." };
  }

  const gates = [gate("identity", "Identity", "pass", address)];

  const [ruleIndex, permissionIndex] = await Promise.all([
    cached(rulesKey(envId), RULES_TTL, () => loadRuleIndex(envId)),
    cached(permissionsKey(envId), RULES_TTL, () => loadPermissionIndex(envId)),
  ]);

  const emailRule = ruleIndex.emails?.[address] || null;
  const domainRule = ruleIndex.domains?.[domainOf(address)] || null;
  const matchedRule = emailRule || domainRule;

  if (!matchedRule || !matchedRule.is_enabled) {
    gates.push(
      gate(
        "allowlist",
        "Allow list",
        "fail",
        matchedRule
          ? `Matched "${matchedRule.value}", but that entry is switched off`
          : `Neither ${address} nor @${domainOf(address)} is on the allow list`,
      ),
      gate(
        "custom_field",
        `${CUSTOM_FIELD_NAME} field`,
        "skipped",
        "Not reached — the allow list already refused this caller",
      ),
      gate("permission", "Permission", "skipped", "Not reached"),
    );

    return {
      allowed: false,
      code: matchedRule ? "ALLOWLIST_DISABLED" : "NOT_WHITELISTED",
      email: address,
      matchedRule,
      source: null,
      permissions: NO_PERMISSIONS,
      gates,
    };
  }

  gates.push(
    gate(
      "allowlist",
      "Allow list",
      "pass",
      matchedRule.rule_type === "domain"
        ? `Matched domain rule @${matchedRule.value}`
        : `Matched email rule ${matchedRule.value}`,
    ),
    gate(
      "custom_field",
      `${CUSTOM_FIELD_NAME} field`,
      "pending",
      `Read from this user's own Wrike profile when they call — it must say "Enabled"`,
    ),
  );

  const override = permissionIndex?.[address] || null;
  const permissions = override ? override.permissions : matchedRule.permissions;
  const source = override ? "user_override" : "rule_baseline";
  const granted = ACTIONS.filter((a) => permissions[a]);

  gates.push(
    gate(
      "permission",
      "Permission",
      granted.length ? "pass" : "fail",
      granted.length
        ? `${granted.join(", ")} — ${
            source === "user_override"
              ? "set for this user directly"
              : `inherited from ${matchedRule.value}`
          }`
        : "No operations granted",
    ),
  );

  return {
    allowed: granted.length > 0,
    code: granted.length ? "ALLOWED_PENDING_FIELD" : "PERMISSION_DENIED",
    email: address,
    matchedRule,
    source,
    permissions,
    gates,
  };
};

export const isEnforced = () => ENFORCED;

export const customFieldName = () => CUSTOM_FIELD_NAME;

export const profileFor = loadProfile;
