import { adminAuthRoute } from "./auth";
import { adminCredentialsRoute } from "./credentials";
import { adminPortalUsersRoute } from "./users";
import { adminCacheRoute } from "./cache";
import { adminEnvironmentAccessRoute } from "./environmentAccess";
import { adminActivityRoute } from "./activity";

// Page handlers
const AdminIndexPage = (req, reply) => reply.redirect("/admin/login");

// Served from the React build (frontend/ -> public/app/, see
// src/plugins/appStatic.js) instead of an EJS template.
const AdminLoginPage = (req, reply) => {
  try {
    return reply.sendFile("admin-login.html", process.cwd() + "/public/app");
  } catch (err) {
    return reply.code(500).send({ error: "Failed to load login page" });
  }
};

const AdminTOTPPage = (req, reply) => {
  try {
    return reply.sendFile("admin-totp.html", process.cwd() + "/public/app");
  } catch (err) {
    return reply.code(500).send({ error: "Failed to load TOTP page" });
  }
};

// Served from the React build (frontend/ -> public/app/, see
// src/plugins/appStatic.js). appUrl/wrikeRedirectUrl are fetched
// client-side from GET /api/v1/app-config instead of being server-injected.
const AdminDashboardPage = (req, reply) => {
  try {
    return reply.sendFile(
      "admin-dashboard.html",
      process.cwd() + "/public/app",
    );
  } catch (err) {
    return reply.code(500).send({ error: "Failed to load dashboard" });
  }
};

export const adminRoute = (fastify, opts, done) => {
  fastify.get("/", AdminIndexPage);
  fastify.get("/login", AdminLoginPage);
  fastify.get("/totp", AdminTOTPPage);
  fastify.get("/dashboard", AdminDashboardPage);

  done();
};

export const adminApiRoute = (fastify, opts, done) => {
  fastify.register(adminAuthRoute);
  fastify.register(adminCredentialsRoute, { prefix: "/credentials" });
  fastify.register(adminPortalUsersRoute, { prefix: "/portal-users" });
  fastify.register(adminCacheRoute, { prefix: "/cache" });
  fastify.register(adminEnvironmentAccessRoute, { prefix: "/environment-access" });
  fastify.register(adminActivityRoute, { prefix: "/activity" });

  done();
};
