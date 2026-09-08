import ipaddr from "ipaddr.js";
import redisClient from "./redis";
import { EnvironmentAccess, WrikeCredentials } from "../controllers";
import { getUserData } from "./wrike";
import {
  IDENTITY_TTL,
  RULES_TTL,
  cached,
  fingerprint,
  identityKey,
  invalidateEnvironment,
  memoryGet,
  memorySet,
  rulesKey,
  switchesKey,
} from "./environmentAccessCache";

// Re-exported so existing importers keep working; the cache module is the
// owner, and the controllers invalidate through it directly.
export { invalidateEnvironment };

/**
 * Environment-level API access scope, evaluated immediately after token
 * validation — the request-path gate for both the REST API
 * (src/middlewares/authentication.js) and MCP (src/plugins/mcp.js).
 *
 * One rule: the caller's email, their email's domain, or their request IP
 * must match an ENABLED allow-list entry for the environment their token
 * belongs to. Match-any wins; no match, no access. Fail-closed throughout —
 * an error resolving the caller's identity is a denial, never a pass.
 *
 * This is deliberately the *only* gate right now. Per-caller CRUD grants and
 * a second custom-field check are a later pass, not started here.
 *
 * Latency shape: a cold check is one Wrike call (resolve the caller's email)
 * plus one query (the environment's rules); a warm check is two in-process
 * Map reads. Three tiers do that work:
 *
 *   L1  in-process Map, short TTL — the steady state, sub-millisecond
 *   L2  Redis, shared across instances — survives a restart, warms new pods
 *   L3  Postgres / the Wrike API — only on a genuine miss
 *
 * The cache itself, and every invalidation of it, lives in
 * ./environmentAccessCache. Admin writes drop it from the controller that
 * performs the write, so a rule or switch change is live on the very next
 * request rather than up to a TTL later.
 */


/* ── Loaders ───────────────────────────────────────────────────────────── */

/**
 * Every enabled entry for one environment, across both surfaces.
 *
 * The API/MCP filter is applied at MATCH time, not here, so one cache entry
 * serves both surfaces instead of splitting the cache in two and doubling the
 * cold-start queries.
 */
const loadRules = async (envId) => {
  const rules = await EnvironmentAccess.GetRulesByEnv(envId);
  return rules
    .filter((r) => r.is_enabled)
    .map((r) => ({
      id: r.id,
      rule_type: r.rule_type,
      value: r.value,
      label: r.label,
      // Rows written before applies_to existed read as null; treat that as
      // the column default rather than as "matches nothing", which would
      // lock out every caller the moment this deployed.
      applies_to: r.applies_to || "both",
    }));
};

/**
 * The two per-environment security switches (schema/env-owned, not the
 * allow-list rows themselves). Missing environment defaults to the same
 * fail-closed posture as everything else here: allow-list check ON.
 */
const loadSwitches = async (envId) => {
  const switches = await WrikeCredentials.GetSwitches(envId);

  // Missing environment defaults to the same fail-closed posture as
  // everything else here: allow-list check ON.
  return (
    switches || {
      allowlistCheckEnabled: true,
      customFieldCheckEnabled: false,
    }
  );
};

/**
 * The caller's email, resolved from their Wrike access token and cached
 * against a digest of it. On a refresh failure this falls back to a stale
 * entry when one exists — a Wrike blip should not lock out a known-good
 * caller mid-session.
 */
const loadIdentity = async (wrikeToken) => {
  const key = identityKey(fingerprint(wrikeToken));

  const local = memoryGet(key);
  if (local !== undefined) return local;

  const remote = await redisClient.get(key);
  if (remote && remote.cachedAt && Date.now() - remote.cachedAt < IDENTITY_TTL * 1000) {
    memorySet(key, remote);
    return remote;
  }

  try {
    const contact = await getUserData(wrikeToken);
    const me = contact?.data?.[0];
    if (!me) throw new Error("Wrike returned no contact for this token");

    const email = String(me.primaryEmail || "").trim().toLowerCase();
    const identity = {
      cachedAt: Date.now(),
      userId: me.id || null,
      email,
      displayName: [me.firstName, me.lastName].filter(Boolean).join(" ").trim() || email,
    };

    memorySet(key, identity);
    redisClient.set(key, identity, IDENTITY_TTL * 4).catch(() => {});

    return identity;
  } catch (err) {
    if (remote) {
      console.warn(
        new Date().toISOString(),
        `[env-access] identity refresh failed, serving cached identity: ${err?.message || err}`,
      );
      memorySet(key, remote);
      return remote;
    }
    throw err;
  }
};

/* ── Matching ──────────────────────────────────────────────────────────── */

const domainOf = (email) => String(email || "").split("@")[1] || "";

/** True if `ip` equals or falls inside `rule.value` (an address or CIDR). */
const ipMatches = (rule, ip) => {
  if (!ip) return false;

  let candidate;
  try {
    candidate = ipaddr.process(ip); // normalises ::ffff:-mapped IPv4, etc.
  } catch {
    return false;
  }

  try {
    if (rule.value.includes("/")) {
      const [range, bits] = ipaddr.parseCIDR(rule.value);
      // A CIDR only matches an address of the same family (parseCIDR/match
      // both throw on a family mismatch rather than silently matching).
      if (candidate.kind() !== range.kind()) return false;
      return candidate.match(range, bits);
    }
    const target = ipaddr.process(rule.value);
    return target.kind() === candidate.kind() && candidate.toString() === target.toString();
  } catch {
    return false;
  }
};

/** The surfaces a request can arrive on. */
export const SURFACE = { API: "api", MCP: "mcp" };

/**
 * True if this entry governs the surface the request arrived on. "both"
 * covers everything; otherwise the entry has to name this surface exactly.
 *
 * An unrecognised surface matches nothing. That is the fail-closed choice: a
 * new transport added later is denied until someone lists it deliberately,
 * rather than inheriting every existing allow-list entry by accident.
 */
const appliesToSurface = (rule, surface) => {
  const scope = rule.applies_to || "both";
  if (scope === "both") return true;
  return scope === surface;
};

const matchRule = (rule, { email, ip, surface }) => {
  if (!appliesToSurface(rule, surface)) return false;
  if (rule.rule_type === "email") return !!email && email === rule.value;
  if (rule.rule_type === "domain") return !!email && domainOf(email) === rule.value;
  if (rule.rule_type === "ip") return ipMatches(rule, ip);
  return false;
};

const SURFACE_LABEL = { api: "REST API", mcp: "MCP" };
const surfaceLabel = (surface) => SURFACE_LABEL[surface] || surface;

/* ── The evaluation ────────────────────────────────────────────────────── */

const gate = (status, detail) => ({ status, detail });

/**
 * Run the allow-list check for one caller against one environment.
 *
 * Always resolves — never throws — so both the request path and the admin
 * check tool render the same structured decision.
 *
 * @param {object} input
 * @param {string} input.envId       Environment the token belongs to
 * @param {string} [input.wrikeToken]  Caller's decrypted Wrike access token
 *                                      (resolves email — omit if you already
 *                                      have it via `email`)
 * @param {string} [input.email]     Pre-resolved email (admin check tool)
 * @param {string} [input.ip]        Caller's request IP
 * @param {string} [input.surface]   Which surface the request arrived on,
 *                                    "api" or "mcp". Entries scoped to the
 *                                    other surface are skipped. Defaults to
 *                                    "api".
 * @returns {Promise<object>} decision
 */
export const evaluateAccess = async ({
  envId,
  wrikeToken,
  email: knownEmail,
  ip,
  surface = SURFACE.API,
}) => {
  if (!envId) {
    return {
      allowed: false,
      code: "ENVIRONMENT_UNKNOWN",
      message: "This token is not bound to an environment, so access rules cannot be applied.",
      email: knownEmail || null,
      ip: ip || null,
      surface,
      matchedRule: null,
      checks: [gate("fail", "Token has no environment")],
    };
  }

  let email = knownEmail ? String(knownEmail).trim().toLowerCase() : null;

  if (!email && wrikeToken) {
    try {
      const identity = await loadIdentity(wrikeToken);
      email = identity.email || null;
    } catch (err) {
      return {
        allowed: false,
        code: "IDENTITY_UNAVAILABLE",
        message: "Could not verify who this token belongs to. Please retry.",
        email: null,
        ip: ip || null,
        surface,
        matchedRule: null,
        checks: [gate("fail", err?.message || "Wrike profile lookup failed")],
      };
    }
  }

  const switches = await cached(switchesKey(envId), RULES_TTL, () => loadSwitches(envId));

  if (!switches.allowlistCheckEnabled) {
    return {
      allowed: true,
      code: "ALLOWED_GATE_DISABLED",
      message: "The allow-list check is switched off for this environment.",
      email: email || null,
      ip: ip || null,
      surface,
      matchedRule: null,
      checks: [
        gate(
          "pass",
          "Email/domain/IP allow-list check is disabled for this environment — every caller passes this gate.",
        ),
      ],
    };
  }

  const rules = await cached(rulesKey(envId), RULES_TTL, () => loadRules(envId));

  const inScope = rules.filter((rule) => appliesToSurface(rule, surface));
  const matched = inScope.find((rule) => matchRule(rule, { email, ip, surface }));

  if (!matched) {
    const identityLine = email
      ? `${email} (domain @${domainOf(email)})`
      : "no identity resolved";

    // Would this caller have been let in on the OTHER surface? If so the
    // entry exists and is simply scoped elsewhere, which is a configuration
    // mistake worth naming precisely instead of reporting a flat "no match"
    // that sends the admin hunting for an entry that is already there.
    const otherSurfaceMatch = rules.find(
      (rule) => !appliesToSurface(rule, surface) && matchRule({ ...rule, applies_to: "both" }, { email, ip, surface }),
    );

    const scopeNote = otherSurfaceMatch
      ? `. An entry for ${otherSurfaceMatch.value} exists but is scoped to ` +
        `${surfaceLabel(otherSurfaceMatch.applies_to)} only`
      : "";

    return {
      allowed: false,
      code: otherSurfaceMatch ? "NOT_ALLOWED_ON_SURFACE" : "NOT_ALLOWED",
      message: otherSurfaceMatch
        ? `This caller is not allowed on the ${surfaceLabel(surface)} for this environment.`
        : "This caller does not match any active allow-list entry for this environment.",
      email: email || null,
      ip: ip || null,
      surface,
      matchedRule: null,
      checks: [
        gate(
          "fail",
          `Checked ${identityLine}${ip ? ` from ${ip}` : ""} against ${inScope.length} active ` +
            `entr${inScope.length === 1 ? "y" : "ies"} for the ${surfaceLabel(surface)} — none matched${scopeNote}`,
        ),
      ],
    };
  }

  const scopeSuffix =
    matched.applies_to === "both"
      ? " (API and MCP)"
      : ` (${surfaceLabel(matched.applies_to)} only)`;

  return {
    allowed: true,
    code: "ALLOWED",
    message: "Authorized.",
    email: email || null,
    ip: ip || null,
    surface,
    matchedRule: matched,
    checks: [
      gate(
        "pass",
        (matched.rule_type === "email"
          ? `Matched email rule ${matched.value}`
          : matched.rule_type === "domain"
            ? `Matched domain rule @${matched.value}`
            : `Matched IP rule ${matched.value}`) + scopeSuffix,
      ),
    ],
  };
};

/**
 * Best-effort client IP for a Fastify request. Requires `trustProxy` on the
 * Fastify instance (see src/index.js) to reflect the real caller rather than
 * a reverse proxy's own address — without it every request looks like it
 * came from the proxy, which makes IP rules either useless or wrong.
 */
export const clientIp = (req) => req?.ip || req?.raw?.socket?.remoteAddress || null;
