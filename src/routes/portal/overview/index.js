import { GetMyOverview } from "./handlers/getOverview";
import {
  verifyPortalJWT,
  requirePasswordChanged,
  requirePortalPermission,
} from "../../../middlewares/portalAuth";

/**
 * The portal dashboard summary — what the "Overview" permission module
 * actually gates. Before this route existed, overview:read was declared in
 * src/utils/portalPermissionCatalog.js but enforced nowhere: the overview
 * page was built entirely out of GET /portal/environments, so it silently
 * needed environments:read instead, and an admin who unticked Overview
 * changed nothing.
 *
 * Read-only by definition (the catalogue gives the module only "read"), and
 * scoped in the handler to the environments the caller owns.
 */
export const portalOverviewRoute = (fastify, opts, done) => {
  const guard = {
    preHandler: [
      verifyPortalJWT,
      requirePasswordChanged,
      requirePortalPermission("overview", "read"),
    ],
  };

  // GET /portal/overview
  fastify.get("/", guard, async (req, reply) => {
    try {
      const result = await GetMyOverview(req.portalUser);
      return reply.code(result?.statusCode || 200).send({
        success: true,
        message: result?.message,
        data: result?.data,
      });
    } catch (err) {
      return reply.code(err?.statusCode || 400).send({
        success: false,
        message: err?.message || err,
      });
    }
  });

  done();
};

export default portalOverviewRoute;
