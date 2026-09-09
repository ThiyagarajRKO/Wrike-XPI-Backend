import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import path from "path";

const root = import.meta.dirname;

// Same routes the Fastify backend serves in production (src/routes/admin,
// src/routes/portal, src/index.js's GET /) — mapped here purely so `npm run
// dev` mirrors those URLs locally instead of requiring the raw entry
// filenames. Production serving is untouched; this only affects the Vite
// dev server. Every migrated page fetches its data client-side (see
// frontend/src/lib/*Api.ts, appConfig.ts), so all of them — including the
// 3 that need real server data — can be served locally by Vite with full
// HMR; the /api + friends proxy below gets them their data from :4000.
const DEV_ROUTES: Record<string, string> = {
  "/": "/root-login.html",
  "/admin": "/admin-login.html",
  "/admin/login": "/admin-login.html",
  "/admin/totp": "/admin-totp.html",
  "/admin/dashboard": "/admin-dashboard.html",
  "/portal": "/portal-login.html",
  "/portal/login": "/portal-login.html",
  "/portal/change-password": "/portal-change-password.html",
  "/portal/dashboard": "/portal-dashboard.html",
  "/portal/home": "/portal-home.html",
};

function devRouteMap(): Plugin {
  return {
    name: "dev-route-map",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url?.split("?")[0];
        const mapped = url && DEV_ROUTES[url];
        if (mapped) req.url = mapped + (req.url!.includes("?") ? req.url!.slice(url!.length) : "");
        next();
      });
    },
  };
}

// Mirrors reference/frontend/vite.config.ts: dedicated outDir matching the
// backend's dedicated static mount (/app/, see src/plugins/appStatic.js),
// base set to the same prefix so emitted asset URLs resolve correctly in the
// PRODUCTION build. In dev mode `base` stays "/" (Vite's dev server applies
// `base` to every request path too, which is why /app/ was showing up
// locally) and devRouteMap() above resolves the real app routes instead.
//
// Multi-page build: one HTML entry per migrated page, each with its own
// small main-*.tsx bootstrap. Backend routes serve the matching HTML file
// directly (reply.sendFile("admin-login.html", ...)); all pages share this
// one build/output so assets never need per-section base configs.
export default defineConfig(({ command }) => {
  process.env.NODE_ENV ||= command === "build" ? "production" : "development";

  return {
    base: command === "build" ? "/app/" : "/",
    plugins: [react(), devRouteMap()],
    resolve: { alias: { "@": path.resolve(root, "./src") } },
    build: {
      outDir: path.resolve(root, "../public/app"),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          "admin-login": path.resolve(root, "admin-login.html"),
          "admin-totp": path.resolve(root, "admin-totp.html"),
          "portal-login": path.resolve(root, "portal-login.html"),
          "portal-change-password": path.resolve(root, "portal-change-password.html"),
          "portal-dashboard": path.resolve(root, "portal-dashboard.html"),
          "portal-home": path.resolve(root, "portal-home.html"),
          "root-login": path.resolve(root, "root-login.html"),
          "admin-dashboard": path.resolve(root, "admin-dashboard.html"),
        },
      },
    },
    server: {
      port: 5174,
      proxy: {
        // Everything the Fastify backend owns — the REST API, the
        // client-fetched page data (environments/redirect-url/app-config),
        // the docs hub, OAuth endpoints/discovery metadata, and the
        // favicon. Extend this list if a new backend-only route is added
        // and shows up as a 404 in `npm run dev`.
        "/api": "http://localhost:4000",
        "/docs": "http://localhost:4000",
        "/oauth": "http://localhost:4000",
        "/.well-known": "http://localhost:4000",
        "/mcp-docs": "http://localhost:4000",
        "/get-redirect-url": "http://localhost:4000",
        "/environments": "http://localhost:4000",
        "/version": "http://localhost:4000",
        "/favicon.ico": "http://localhost:4000",
      },
    },
  };
});
