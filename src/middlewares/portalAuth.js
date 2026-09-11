import jwt from "jsonwebtoken";
import { PortalAuth, PortalPermissions } from "../controllers";

// Verifies portal user JWT from Authorization header.
// Attaches portalUser to req: { id, username, role, must_change_password }
export const verifyPortalJWT = async (req, reply) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply
        .code(401)
        .send({ success: false, message: "Unauthorized: missing token" });
    }

    const token = authHeader.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const user = await PortalAuth.GetById(payload?.sub);
    if (!user?.id || !user?.is_active) {
      return reply
        .code(401)
        .send({ success: false, message: "Unauthorized: user not found" });
    }

    req.portalUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      must_change_password: user.must_change_password,
    };
  } catch {
    return reply.code(401).send({
      success: false,
      message: "Unauthorized: invalid or expired token",
    });
  }
};

// Restricts access to admin-role portal users only.
export const requireAdminRole = async (req, reply) => {
  if (!req.portalUser || req.portalUser.role !== "admin") {
    return reply
      .code(403)
      .send({ success: false, message: "Forbidden: admin access required" });
  }
};

// Blocks access if the user must change their password first.
export const requirePasswordChanged = async (req, reply) => {
  if (req.portalUser?.must_change_password) {
    return reply.code(403).send({
      success: false,
      must_change_password: true,
      message: "Password change required before proceeding",
    });
  }
};

/**
 * Module-level CRUD gate for portal users — the server-side counterpart to
 * the admin console's permission popup (src/utils/portalPermissionCatalog.js
 * defines the vocabulary, src/controllers/portalPermissions.js stores it).
 *
 * Hiding a button in the portal UI is cosmetic on its own; this is what
 * actually stops the request. Returns a factory so a route can write
 * `requirePortalPermission("environments", "delete")` inline in its guard
 * list, matching the shape of every other preHandler here.
 *
 * Applies uniformly regardless of portalUser.role — role only changes which
 * *rows* a module like Environments returns (see GetMyEnvironments), not
 * whether the module is reachable at all. The admin console lets an admin
 * edit an "admin"-role portal user's matrix too, so there is no role that
 * should silently bypass it.
 */
export const requirePortalPermission = (moduleKey, action) => {
  return async (req, reply) => {
    if (!req.portalUser?.id) {
      return reply
        .code(401)
        .send({ success: false, message: "Unauthorized: missing token" });
    }

    try {
      const matrix = await PortalPermissions.GetMatrix(req.portalUser.id);
      if (!matrix?.[moduleKey]?.[action]) {
        return reply.code(403).send({
          success: false,
          message: "Forbidden: you do not have access to this feature",
        });
      }
    } catch {
      return reply
        .code(403)
        .send({ success: false, message: "Forbidden: permission check failed" });
    }
  };
};
