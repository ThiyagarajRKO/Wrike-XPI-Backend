/**
 * Turns a Fastify request/reply into a bounded, redacted JSON snapshot for
 * the activity log's `request_payload` / `response_payload` columns.
 *
 * Safety rules:
 *  - Secrets are never stored: keys matching tokens/secrets/passwords/codes
 *    are replaced with "[redacted]" before anything is persisted.
 *  - Headers are allow-listed (a handful of useful, non-sensitive ones) —
 *    we never dump the whole header map.
 *  - Everything is bounded: strings are capped, arrays/objects are limited,
 *    and the final snapshot is dropped to its skeleton if it would still
 *    exceed the size cap. This table is written to on every call, so it must
 *    never become a place to dump arbitrarily large payloads.
 */

const MAX_STRING = 4000; // per string value
const MAX_KEYS = 120; // per object
const MAX_ARRAY = 100; // per array
const MAX_DEPTH = 6;
const MAX_SNAPSHOT_CHARS = 120 * 1024; // ~120KB per snapshot ceiling

const SAFE_HEADERS = [
  "content-type",
  "accept",
  "accept-language",
  "user-agent",
  "referer",
  "origin",
  "host",
  "x-forwarded-for",
  "x-request-id",
];

const SENSITIVE_KEY =
  /secret|password|passwd|token|authorization|api[_-]?key|cookie|^code$|^state$|grant_type|refresh/i;

const isSensitiveKey = (key) => SENSITIVE_KEY.test(String(key));

const sanitize = (value, depth = 0) => {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…[truncated]`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth > MAX_DEPTH) return "[depth limit]";

  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => sanitize(v, depth + 1));
    if (value.length > MAX_ARRAY)
      out.push(`…[${value.length - MAX_ARRAY} more items]`);
    return out;
  }

  if (typeof value === "object") {
    const out = {};
    const entries = Object.entries(value);
    for (let i = 0; i < entries.length && i < MAX_KEYS; i++) {
      const [k, v] = entries[i];
      if (isSensitiveKey(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = sanitize(v, depth + 1);
      }
    }
    if (entries.length > MAX_KEYS)
      out["…"] = `[${entries.length - MAX_KEYS} more keys]`;
    return out;
  }

  return String(value).slice(0, MAX_STRING);
};

const safeStringify = (value) => {
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? json : null;
  } catch {
    return null;
  }
};

/** Enforce the hard ceiling; if the snapshot is still huge, slim it down. */
const capSnapshot = (snapshot) => {
  if (!snapshot) return null;
  let json = safeStringify(snapshot);
  if (json && json.length <= MAX_SNAPSHOT_CHARS) return snapshot;

  const slim = { ...snapshot };
  delete slim.body;
  slim.body = "[omitted: payload too large]";
  json = safeStringify(slim);
  return json && json.length <= MAX_SNAPSHOT_CHARS ? slim : null;
};

/**
 * Snapshot the interesting parts of a request: allow-listed headers, query,
 * path params, and body — all sanitised and bounded.
 */
export const captureRequest = (req) => {
  const headers = {};
  const raw = req?.headers || {};
  SAFE_HEADERS.forEach((name) => {
    if (raw[name] !== undefined) headers[name] = raw[name];
  });

  const snap = {};
  if (Object.keys(headers).length) snap.headers = headers;

  const query = req?.query && Object.keys(req.query).length ? req.query : null;
  if (query) snap.query = sanitize(query);

  const params =
    req?.params && Object.keys(req.params).length ? req.params : null;
  if (params) snap.params = sanitize(params);

  if (req?.body !== undefined && req.body !== null)
    snap.body = sanitize(req.body);

  return capSnapshot(snap);
};

/**
 * Snapshot a response: its status code plus a sanitised parse of the payload
 * that was actually sent on the wire (strings are JSON-parsed when possible).
 */
export const buildResponseSnapshot = (statusCode, payload) => {
  let parsed = payload;
  if (typeof payload === "string") {
    try {
      parsed = JSON.parse(payload);
    } catch {
      parsed =
        payload.length > MAX_STRING
          ? { raw: `${payload.slice(0, MAX_STRING)}…[truncated]` }
          : { raw: payload };
    }
  }
  if (Buffer.isBuffer(parsed)) {
    const s = parsed.toString("utf8").slice(0, MAX_STRING);
    parsed = { raw: s };
  }

  const snap = { status_code: statusCode ?? null };
  if (parsed !== undefined && parsed !== null) snap.body = sanitize(parsed);
  return capSnapshot(snap);
};

/**
 * Map a logged route URL to a coarse module category so the console can say
 * "this was a Campaign call" at a glance. Falls back to "other".
 */
export const categoryForUrl = (url = "") => {
  const segments = String(url)
    .replace(/^\/api\/v1/, "")
    .split("/")
    .filter(Boolean);
  // Typical route url: /wrikexpi/campaign/:campaignId  → segment[1] = campaign
  const module = segments[1] || segments[0] || "";
  if (module === "campaign") return "campaign";
  if (module === "channel") return "channel";
  if (module === "task") return "task";
  if (module === "token") return "token";
  if (module === "v1.0" || module === "master") return "master";
  if (module === "amoeba") return "amoeba";
  if (module === "mcp") return "mcp";
  return "other";
};
