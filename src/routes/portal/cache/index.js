import { listCacheEntries, getCacheDetail } from "../../../utils/cacheInspector";
import redisClient from "../../../utils/redis";
import {
  verifyPortalJWT,
  requirePasswordChanged,
  requirePortalPermission,
} from "../../../middlewares/portalAuth";

/**
 * Portal API over cached Redis keys — browse/inspect (read) plus single-key
 * delete, the same inspector logic and delMany call
 * src/routes/admin/cache/index.js uses. Bulk-delete stays admin-only: the
 * "cache" portal-permission module (src/utils/portalPermissionCatalog.js)
 * grants "read" and "delete", not a separate bulk action, so a portal user
 * clears keys one at a time.
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
      const data = await listCacheEntries({ pattern: patternInput, limit: req.query?.limit });

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

  done();
};

export default portalCacheRoute;
