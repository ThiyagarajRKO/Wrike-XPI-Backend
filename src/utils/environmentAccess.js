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
 * What a denied caller sees, on every surface (REST, MCP, OAuth/token
 * exchange). The `message`/`checks` a decision carries below are diagnostic
 * prose written for the admin console and activity log — they name the
 * allow-list mechanism, list who was checked against what, and suggest
 * fixes. None of that is this caller's business, and handing it to them
 * exposes exactly how the gate works to whoever is being kept out. Every
 * request-path gate must show this string instead and drop `checks`
 * entirely from what it sends back.
 */
export const PUBLIC_DENIAL_MESSAGE =
  "You are not authorized to access this resource.";

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

const SURFACE_LABEL = { api: "API", mcp: "MCP" };
const surfaceLabel = (surface) => SURFACE_LABEL[surface] || surface;

/* ── Plain-language explanations ────────────────────────────────────────
   These strings are read by admins in the console, most of whom are not
   developers. They say who was checked, what happened, and what to do about
   it. No jargon ("rule", "match", "entry count"), no counts of internal
   objects, and nothing that only makes sense if you have read this file. */

/** "someone@acme.com", or a description of what we do know, for a caller. */
const describeCaller = (email, ip) => {
  if (email && ip) return `${email} (connecting from ${ip})`;
  if (email) return email;
  if (ip) return `the computer at ${ip}`;
  return "this caller";
};

/** Capitalise a fragment being used to open a sentence. */
const opening = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** "a, b and c" — an actual sentence, not a run of repeated clauses. */
const list = (items) => {
  const parts = items.filter(Boolean);
  if (parts.length <= 1) return parts[0] || "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
};

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
      message: "This login is not linked to an environment, so its allow list cannot be checked.",
      email: knownEmail || null,
      ip: ip || null,
      surface,
      matchedRule: null,
      checks: [
        gate(
          "fail",
          "This login is not linked to any environment, so there is no allow list to check it " +
            "against. Someone will need to reconnect it to an environment.",
        ),
      ],
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
        message: "We could not confirm who is calling, so the request was refused.",
        email: null,
        ip: ip || null,
        surface,
        matchedRule: null,
        checks: [
          gate(
            "fail",
            "Wrike did not tell us which person this login belongs to, so there was no email " +
              "address to check against the allow list. This is usually temporary. If it keeps " +
              `happening, the connection to Wrike may need to be renewed. (${
                err?.message || "no response from Wrike"
              })`,
          ),
        ],
      };
    }
  }

  const switches = await cached(switchesKey(envId), RULES_TTL, () => loadSwitches(envId));

  if (!switches.allowlistCheckEnabled) {
    return {
      allowed: true,
      code: "ALLOWED_GATE_DISABLED",
      message: "The allow list is switched off for this environment, so everyone is let through.",
      email: email || null,
      ip: ip || null,
      surface,
      matchedRule: null,
      checks: [
        gate(
          "pass",
          "The allow list is switched off for this environment, so nothing is being checked and " +
            "anyone with a valid login can get in. Switch it back on to start enforcing the list.",
        ),
      ],
    };
  }

  const rules = await cached(rulesKey(envId), RULES_TTL, () => loadRules(envId));

  const inScope = rules.filter((rule) => appliesToSurface(rule, surface));
  const matched = inScope.find((rule) => matchRule(rule, { email, ip, surface }));

  if (!matched) {
    const caller = describeCaller(email, ip);

    // Would this caller have been let in on the OTHER surface? If so the
    // entry already exists and is simply pointed at the wrong place, which is
    // a far more useful thing to say than "not on the list" and saves the
    // admin hunting for an entry that is sitting right in front of them.
    const otherSurfaceMatch = rules.find(
      (rule) =>
        !appliesToSurface(rule, surface) &&
        matchRule({ ...rule, applies_to: "both" }, { email, ip, surface }),
    );

    if (otherSurfaceMatch) {
      const listed =
        otherSurfaceMatch.rule_type === "domain"
          ? `Anyone at ${otherSurfaceMatch.value}`
          : otherSurfaceMatch.value;

      return {
        allowed: false,
        code: "NOT_ALLOWED_ON_SURFACE",
        message: `${opening(caller)} is on the allow list, but it is set to ${surfaceLabel(
          otherSurfaceMatch.applies_to,
        )} only, and this was ${surfaceLabel(surface)}.`,
        email: email || null,
        ip: ip || null,
        surface,
        matchedRule: null,
        checks: [
          gate(
            "fail",
            `${listed} is already on the allow list, but set to work with ` +
              `${surfaceLabel(otherSurfaceMatch.applies_to)} only. This request came in through ` +
              `${surfaceLabel(surface)}, so it was refused. To let it through, change that ` +
              `entry's "Applies to" setting to ${surfaceLabel(surface)} or to API + MCP.`,
          ),
        ],
      };
    }

    // Nothing on the list at all is a different situation from "there is a
    // list and you are not on it", and the fix is different too.
    const emptyList = inScope.length === 0;
    const suggestion = email
      ? `Add ${email}, or allow everyone at ${domainOf(email)}.`
      : ip
        ? `Add ${ip} to the allow list.`
        : "Add an email address, a domain, or an IP address to the allow list.";

    return {
      allowed: false,
      code: "NOT_ALLOWED",
      message: emptyList
        ? "Nobody has been added to the allow list yet, so every caller is being refused."
        : `${opening(caller)} is not on the allow list for this environment.`,
      email: email || null,
      ip: ip || null,
      surface,
      matchedRule: null,
      checks: [
        gate(
          "fail",
          emptyList
            ? `The allow list for ${surfaceLabel(surface)} is empty, so nobody can get in, ` +
              `including ${caller}. ${suggestion}`
            : `Nothing on the allow list covers this caller. We looked for ` +
              `${list([
                email,
                email ? `anyone at ${domainOf(email)}` : null,
                ip ? `the address ${ip}` : null,
              ])}, and found none of them. ${suggestion}`,
        ),
      ],
    };
  }

  const because =
    matched.rule_type === "email"
      ? `${matched.value} is on the allow list`
      : matched.rule_type === "domain"
        ? `everyone at ${matched.value} is on the allow list`
        : `the IP address ${matched.value} is on the allow list`;

  const scopeNote =
    matched.applies_to === "both"
      ? "That entry covers both API and MCP."
      : `That entry is set to ${surfaceLabel(matched.applies_to)} only, which is how this request came in.`;

  return {
    allowed: true,
    code: "ALLOWED",
    message: "Allowed.",
    email: email || null,
    ip: ip || null,
    surface,
    matchedRule: matched,
    checks: [
      gate(
        "pass",
        `${opening(describeCaller(email, ip))} is allowed because ${because}. ${scopeNote}`,
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
