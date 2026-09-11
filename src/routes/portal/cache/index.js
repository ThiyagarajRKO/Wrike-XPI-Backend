import {
  listCacheEntries,
  getCacheDetail,
} from "../../../utils/cacheInspector";
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
      const data = await listCacheEntries({
        pattern: patternInput,
        limit: req.query?.limit,
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
