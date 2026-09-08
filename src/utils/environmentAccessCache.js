import crypto from "crypto";
import redisClient from "./redis";

require("dotenv").config();

/**
 * The cache behind the environment API access scope gate, and the single
 * place that invalidates it.
 *
 * Split out of src/utils/environmentAccess.js so the CONTROLLERS that write
 * access-scope data can invalidate without importing the policy engine (which
 * imports the controllers, and would therefore be a require cycle). This
 * module deliberately imports nothing but redis.
 *
 * Why the split matters beyond the cycle: invalidation used to be the route
 * layer's job, so every new write path had to remember to call it. One did
 * not (a custom_field_check_enabled-only toggle left a stale switch entry),
 * and nothing about that was detectable at the call site. Invalidating from
 * the controller instead makes it structural: if a write goes through the
 * controller, the cache is dropped.
 *
 * Two tiers sit in front of Postgres:
 *   L1  this process's Map, short TTL. Sub-millisecond, per-instance.
 *   L2  Redis, shared. Survives restarts and warms new instances.
 *
 * Invalidation clears L1 for THIS process and L2 for everyone. On a
 * multi-instance deploy, other instances keep their own L1 copy until it
 * expires, so ENV_ACCESS_MEMORY_TTL is the real upper bound on how long a
 * revoked caller can still get in cluster-wide. Keep it short; it is not the
 * knob to raise for performance. ENV_ACCESS_RULES_TTL (L2) is, because this
 * module clears it for every instance at once.
 */

const seconds = (name, fallback) => {
  const parsed = parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const RULES_TTL = seconds("ENV_ACCESS_RULES_TTL", 300);
export const IDENTITY_TTL = seconds("ENV_ACCESS_IDENTITY_TTL", 300);
export const L1_TTL_MS = seconds("ENV_ACCESS_MEMORY_TTL", 30) * 1000;

/* ── Keys ──────────────────────────────────────────────────────────────── */

export const rulesKey = (envId) => `xpi:envaccess:rules:${envId}`;
export const switchesKey = (envId) => `xpi:envaccess:switches:${envId}`;
export const identityKey = (fingerprintValue) => `xpi:envaccess:identity:${fingerprintValue}`;

// The token is never stored, only an opaque digest of it, so a cache dump
// can't be replayed against Wrike.
export const fingerprint = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 32);

/* ── L1: in-process cache ──────────────────────────────────────────────── */

const memory = new Map();

export const memoryGet = (key) => {
  const hit = memory.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    memory.delete(key);
    return undefined;
  }
  return hit.value;
};

export const memorySet = (key, value, ttlMs = L1_TTL_MS) => {
  memory.set(key, { value, expiresAt: Date.now() + ttlMs });
};

/**
 * Read through L1 → L2 → loader, writing back to both on the way out. Redis
 * being down is not an error: redisClient degrades to null, so the request
 * falls through to the loader and still succeeds.
 */
export const cached = async (key, ttlSeconds, loader) => {
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

/* ── Invalidation ──────────────────────────────────────────────────────── */

/**
 * Drop everything cached about one environment's access scope, L1 and L2:
 * its allow-list rules (every email, domain and IP entry) and both security
 * switches. Both keys always go together. They are loaded independently but
 * they answer one question, and a caller that changed either one is entitled
 * to see the whole decision recomputed on its next request.
 *
 * Never throws: a Redis outage must not fail an admin's save. The write has
 * already committed, and the entry expires on its own within RULES_TTL.
 */
export const invalidateEnvironment = async (envId) => {
  if (!envId) return;

  const keys = [rulesKey(envId), switchesKey(envId)];
  keys.forEach((key) => memory.delete(key));

  await redisClient.delMany(keys).catch((err) => {
    console.warn(
      new Date().toISOString(),
      `[env-access] Redis invalidation failed for ${envId}, entry will expire in <=${RULES_TTL}s: ${
        err?.message || err
      }`,
    );
  });
};

/** Test/ops hook: forget everything cached here, across all environments. */
export const invalidateAll = async () => {
  memory.clear();
  const keys = await redisClient.keys("xpi:envaccess:*").catch(() => []);
  if (keys && keys.length) await redisClient.delMany(keys).catch(() => {});
};
