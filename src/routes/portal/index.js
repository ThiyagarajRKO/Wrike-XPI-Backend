import { portalAuthRoute } from "./auth";
import { portalUsersRoute } from "./users";
import { portalEnvironmentsRoute } from "./environments";
import { portalActivityRoute } from "./activity";
import { portalCacheRoute } from "./cache";

// Page handlers
const PortalIndexPage = (req, reply) => reply.redirect("/portal/login");

// Served from the React build (frontend/ -> public/app/, see
// src/plugins/appStatic.js) instead of an EJS template.
const PortalLoginPage = (req, reply) => {
  try {
    return reply.sendFile("portal-login.html", process.cwd() + "/public/app");
  } catch (err) {
    return reply.code(500).send({ error: "Failed to load login page" });
  }
};

const PortalChangePasswordPage = (req, reply) => {
  try {
    return reply.sendFile(
      "portal-change-password.html",
      process.cwd() + "/public/app",
    );
  } catch (err) {
    return reply
      .code(500)
      .send({ error: "Failed to load change password page" });
  }
};

const PortalDashboardPage = (req, reply) => {
  try {
    return reply.sendFile("portal-dashboard.html", process.cwd() + "/public/app");
  } catch (err) {
    return reply.code(500).send({ error: "Failed to load dashboard" });
  }
};

// Served from the React build (frontend/ -> public/app/, see
// src/plugins/appStatic.js). appUrl/wrikeRedirectUrl are fetched
// client-side from GET /api/v1/app-config instead of being server-injected.
const PortalUserPage = (req, reply) => {
  try {
    return reply.sendFile("portal-home.html", process.cwd() + "/public/app");
  } catch (err) {
    return reply.code(500).send({ error: "Failed to load user page" });
  }
};

// Page routes (rendered views)
export const portalRoute = (fastify, opts, done) => {
  fastify.get("/", PortalIndexPage);
  fastify.get("/login", PortalLoginPage);
  fastify.get("/change-password", PortalChangePasswordPage);
  fastify.get("/dashboard", PortalDashboardPage);
  fastify.get("/home", PortalUserPage);

  done();
};

// API routes
export const portalApiRoute = (fastify, opts, done) => {
  fastify.register(portalAuthRoute, { prefix: "/auth" });
  fastify.register(portalUsersRoute, { prefix: "/users" });
  fastify.register(portalEnvironmentsRoute, { prefix: "/environments" });
  fastify.register(portalActivityRoute, { prefix: "/activity-logs" });
  fastify.register(portalCacheRoute, { prefix: "/cache" });

  done();
};
