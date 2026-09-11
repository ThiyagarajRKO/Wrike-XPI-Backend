import redisClient from "./redis";

/**
 * Shared read-side logic for browsing Redis keys — used by both the
 * super-admin cache console (src/routes/admin/cache/index.js, which also
 * adds delete/bulk-delete) and the read-only portal "Cache Settings" module
 * (src/routes/portal/cache/index.js). Extracted so the two never drift on
 * how a value/TTL gets formatted.
 */

const DEFAULT_PATTERN = "*";
const MAX_LIST_LIMIT = 500;

const hasWildcard = (value) => /[*?\[\]]/.test(value);

const iLikeIncludes = (value, search) =>
  String(value || "")
    .toLowerCase()
    .includes(String(search || "").toLowerCase());

export const toTtlLabel = (ttlSeconds) => {
  if (ttlSeconds === null || ttlSeconds === undefined) return "Unavailable";
  if (ttlSeconds === -2) return "Missing";
  if (ttlSeconds === -1) return "No Expiry";
  if (ttlSeconds < 60) return `${ttlSeconds}s`;
  if (ttlSeconds < 3600)
    return `${Math.floor(ttlSeconds / 60)}m ${ttlSeconds % 60}s`;
  if (ttlSeconds < 86400)
    return `${Math.floor(ttlSeconds / 3600)}h ${Math.floor((ttlSeconds % 3600) / 60)}m`;
  return `${Math.floor(ttlSeconds / 86400)}d ${Math.floor((ttlSeconds % 86400) / 3600)}h`;
};

const safeJsonPreview = (value, maxLength = 180) => {
  try {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    if (!raw) return "";
    return raw.length > maxLength ? `${raw.slice(0, maxLength)}…` : raw;
  } catch {
    return "[unserializable]";
  }
};

const inferValueType = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

export const getCacheValue = async (key) => {
  const jsonValue = await redisClient.get(key);
  if (jsonValue !== null && jsonValue !== undefined) {
    return {
      value: jsonValue,
      valueType: inferValueType(jsonValue),
      preview: safeJsonPreview(jsonValue),
      source: "json",
    };
  }

  const stringValue = await redisClient.getString(key);
  if (stringValue !== null && stringValue !== undefined) {
    let parsed = stringValue;
    let parsedAsJson = false;

    try {
      parsed = JSON.parse(stringValue);
      parsedAsJson = true;
    } catch {
      parsed = stringValue;
    }

    return {
      value: parsed,
      valueType: parsedAsJson ? inferValueType(parsed) : "string",
      preview: safeJsonPreview(parsed),
      source: parsedAsJson ? "string-json" : "string",
    };
  }

  return {
    value: null,
    valueType: "unknown",
    preview: "",
    source: "unknown",
  };
};

/** Resolves the key list + entries payload GET /cache and GET /cache/detail share. */
export const listCacheEntries = async ({ pattern: patternInput, limit }) => {
  const pattern = patternInput || DEFAULT_PATTERN;
  const safeLimit = Math.min(Math.max(parseInt(limit || "200", 10) || 200, 1), MAX_LIST_LIMIT);

  let keys = [];
  let searchMode = "pattern";

  if (!patternInput) {
    keys = await redisClient.keys(DEFAULT_PATTERN);
    searchMode = "all";
  } else if (hasWildcard(patternInput)) {
    keys = await redisClient.keys(patternInput);
    searchMode = "pattern";
  } else {
    const allKeys = await redisClient.keys(DEFAULT_PATTERN);
    keys = allKeys.filter((key) => iLikeIncludes(key, patternInput));
    searchMode = "ilike";
  }

  keys = keys.slice(0, safeLimit);

  const entries = await Promise.all(
    keys.map(async (key) => {
      const [ttlSeconds, redisType, valueInfo] = await Promise.all([
        redisClient.ttl(key),
        redisClient.type(key),
        getCacheValue(key),
      ]);

      const approximateSize = valueInfo?.preview
        ? Buffer.byteLength(valueInfo.preview, "utf8")
        : 0;

      return {
        key,
        redis_type: redisType || "unknown",
        value_type: valueInfo.valueType,
        ttl_seconds: ttlSeconds,
        ttl_label: toTtlLabel(ttlSeconds),
        size_bytes: approximateSize,
        preview: valueInfo.preview,
      };
    }),
  );

  return { pattern, mode: searchMode, total: entries.length, entries };
};

export const getCacheDetail = async (key) => {
  const [ttlSeconds, redisType, valueInfo] = await Promise.all([
    redisClient.ttl(key),
    redisClient.type(key),
    getCacheValue(key),
  ]);

  return {
    key,
    redis_type: redisType || "unknown",
    value_type: valueInfo.valueType,
    ttl_seconds: ttlSeconds,
    ttl_label: toTtlLabel(ttlSeconds),
    value_source: valueInfo.source,
    value: valueInfo.value,
  };
};
