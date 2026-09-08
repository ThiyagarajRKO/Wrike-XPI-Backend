import crypto from "crypto";
import ipaddr from "ipaddr.js";
import redisClient from "./redis";
import { EnvironmentAccess, WrikeCredentials } from "../controllers";
import { getUserData } from "./wrike";

require("dotenv").config();

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
 * Admin writes invalidate L1+L2 for the affected environment synchronously,
 * so a rule change is live on the very next request.
 */

/* ── Configuration ─────────────────────────────────────────────────────── */

const seconds = (name, fallback) => {
  const parsed = parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const RULES_TTL = seconds("ENV_ACCESS_RULES_TTL", 300); // 5 min
const IDENTITY_TTL = seconds("ENV_ACCESS_IDENTITY_TTL", 300); // 5 min
const L1_TTL_MS = seconds("ENV_ACCESS_MEMORY_TTL", 30) * 1000; // 30 s

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

/**
 * Read through L1 → L2 → loader, writing back to both on the way out. Redis
 * being down is not an error here: redisClient already degrades to null, so
 * the request falls through to the loader and still succeeds.
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

const rulesKey = (envId) => `xpi:envaccess:rules:${envId}`;
const switchesKey = (envId) => `xpi:envaccess:switches:${envId}`;
const identityKey = (fingerprint) => `xpi:envaccess:identity:${fingerprint}`;

// The token is never stored — only an opaque digest of it, so a cache dump
// can't be replayed against Wrike.
const fingerprint = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 32);

/* ── Loaders ───────────────────────────────────────────────────────────── */

const loadRules = async (envId) => {
  const rules = await EnvironmentAccess.GetRulesByEnv(envId);
  return rules
    .filter((r) => r.is_enabled)
    .map((r) => ({ id: r.id, rule_type: r.rule_type, value: r.value, label: r.label }));
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

/* ── Invalidation ──────────────────────────────────────────────────────── */

/** Drop the cached rule index and switch state for one environment, L1 and L2. */
export const invalidateEnvironment = async (envId) => {
  if (!envId) return;
  const keys = [rulesKey(envId), switchesKey(envId)];
  keys.forEach((key) => memory.delete(key));
  await redisClient.delMany(keys).catch(() => {});
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

const matchRule = (rule, { email, ip }) => {
  if (rule.rule_type === "email") return !!email && email === rule.value;
  if (rule.rule_type === "domain") return !!email && domainOf(email) === rule.value;
  if (rule.rule_type === "ip") return ipMatches(rule, ip);
  return false;
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
 * @returns {Promise<object>} decision
 */
export const evaluateAccess = async ({ envId, wrikeToken, email: knownEmail, ip }) => {
  if (!envId) {
    return {
      allowed: false,
      code: "ENVIRONMENT_UNKNOWN",
      message: "This token is not bound to an environment, so access rules cannot be applied.",
      email: knownEmail || null,
      ip: ip || null,
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

  const matched = rules.find((rule) => matchRule(rule, { email, ip }));

  if (!matched) {
    const identityLine = email
      ? `${email} (domain @${domainOf(email)})`
      : "no identity resolved";
    return {
      allowed: false,
      code: "NOT_ALLOWED",
      message: "This caller does not match any active allow-list entry for this environment.",
      email: email || null,
      ip: ip || null,
      matchedRule: null,
      checks: [
        gate(
          "fail",
          `Checked ${identityLine}${ip ? ` from ${ip}` : ""} against ${rules.length} active ` +
            `entr${rules.length === 1 ? "y" : "ies"} — none matched`,
        ),
      ],
    };
  }

  return {
    allowed: true,
    code: "ALLOWED",
    message: "Authorized.",
    email: email || null,
    ip: ip || null,
    matchedRule: matched,
    checks: [
      gate(
        "pass",
        matched.rule_type === "email"
          ? `Matched email rule ${matched.value}`
          : matched.rule_type === "domain"
            ? `Matched domain rule @${matched.value}`
            : `Matched IP rule ${matched.value}`,
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
