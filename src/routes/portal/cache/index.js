import {
  listCacheEntries,
  getCacheDetail,
} from "../../../utils/cacheInspector";
import { cacheKeyFilterFor } from "../../../utils/portalCacheScope";
import redisClient from "../../../utils/redis";
import {
  verifyPortalJWT,
  requirePasswordChanged,
  requirePortalPermission,
} from "../../../middlewares/portalAuth";

/**
 * Portal API over cached Redis keys — browse/inspect (read) plus single-key
 * and bulk delete, the same inspector logic and delMany calls
 * src/routes/admin/cache/index.js uses.
 *
 * Both deletes hang off the one "cache:delete" grant
 * (src/utils/portalPermissionCatalog.js): clearing many keys is that action
 * applied to more keys, not a separate capability worth its own permission.
 *
 * Row-level scoping, applied on every route below: the cache is one global
 * keyspace with no owner column, so a portal user is served only the entries
 * attributable to an environment they own — see
 * src/utils/portalCacheScope.js for the rule and why it is default-deny.
 * The admin console keeps the unscoped view; a portal user asking for a key
 * outside their set gets 403 and nothing is read or deleted.
 */
export const portalCacheRoute = (fastify, opts, done) => {
  const canRead = {
    preHandler: [
      verifyPortalJWT,
      requirePasswordChanged,
      requirePortalPermission("cache", "read"),
    ],
  };
  const canDelete = {
    preHandler: [
      verifyPortalJWT,
      requirePasswordChanged,
      requirePortalPermission("cache", "delete"),
    ],
  };

  // GET /portal/cache?pattern=*&limit=200
  fastify.get("/", canRead, async (req, reply) => {
    try {
      const patternInput = String(req.query?.pattern || "").trim();
      const keyFilter = await cacheKeyFilterFor(req.portalUser);
      const data = await listCacheEntries({
        pattern: patternInput,
        limit: req.query?.limit,
        filter: keyFilter,
      });

      return reply.code(200).send({
        success: true,
        message: "Cache entries fetched",
        data,
      });
    } catch (err) {
      return reply.code(err?.statusCode || 400).send({
        success: false,
        message: err?.message || "Failed to fetch cache entries",
      });
    }
  });

  // GET /portal/cache/detail?key=cache:key
  fastify.get("/detail", canRead, async (req, reply) => {
    try {
      const key = String(req.query?.key || "").trim();
      if (!key) {
        return reply.code(400).send({ success: false, message: "Missing key" });
      }

      const keyFilter = await cacheKeyFilterFor(req.portalUser);
      if (!keyFilter(key)) {
        return reply.code(403).send({
          success: false,
          message: "Forbidden: you do not have access to this cache entry",
        });
      }

      const data = await getCacheDetail(key);

      return reply.code(200).send({
        success: true,
        message: "Cache detail fetched",
        data,
      });
    } catch (err) {
      return reply.code(err?.statusCode || 400).send({
        success: false,
        message: err?.message || "Failed to fetch cache detail",
      });
    }
  });

  // DELETE /portal/cache?key=cache:key
  fastify.delete("/", canDelete, async (req, reply) => {
    try {
      const key = String(req.query?.key || "").trim();
      if (!key) {
        return reply.code(400).send({ success: false, message: "Missing key" });
      }

      const keyFilter = await cacheKeyFilterFor(req.portalUser);
      if (!keyFilter(key)) {
        return reply.code(403).send({
          success: false,
          message: "Forbidden: you do not have access to this cache entry",
        });
      }

      const deleted = await redisClient.delMany([key]);

      return reply.code(200).send({
        success: true,
        message: deleted > 0 ? "Cache entry deleted" : "Cache entry not found",
        data: { key, deleted: deleted > 0 },
      });
    } catch (err) {
      return reply.code(err?.statusCode || 400).send({
        success: false,
        message: err?.message || "Failed to delete cache entry",
      });
    }
  });

  // POST /portal/cache/bulk-delete { keys: ["key1", "key2"] }
  fastify.post("/bulk-delete", canDelete, async (req, reply) => {
    try {
      const keys = Array.isArray(req.body?.keys)
        ? req.body.keys.map((item) => String(item || "").trim()).filter(Boolean)
        : [];

      if (keys.length === 0) {
        return reply.code(400).send({
          success: false,
          message: "At least one cache key is required",
        });
      }

      // Fail the whole batch rather than deleting part of it: a request that
      // names even one key outside this caller's set is refused outright, and
      // the response deliberately does not echo back which key it was.
      const keyFilter = await cacheKeyFilterFor(req.portalUser);
      if (keys.some((key) => !keyFilter(key))) {
        return reply.code(403).send({
          success: false,
          message:
            "Forbidden: you do not have access to one or more of those cache entries",
        });
      }

      const deletedCount = await redisClient.delMany(keys);

      return reply.code(200).send({
        success: true,
        message: `${deletedCount} cache key(s) deleted`,
        data: {
          requested: keys.length,
          deleted: deletedCount,
        },
      });
    } catch (err) {
      return reply.code(err?.statusCode || 400).send({
        success: false,
        message: err?.message || "Failed to bulk delete cache entries",
      });
    }
  });

  done();
};

export default portalCacheRoute;
