import crypto from "crypto";
import { findRedirectionURL } from "../../utils/wrikeRedirect";
import { getCachedVisibleWrikeCredentials } from "../../utils/wrikeCredentials";
import { WrikeTokenExchange } from "../tokens/handlers/wrikeTokenExchange";
import { ResolveAuthFromJWT } from "../../middlewares/authentication";
import { clientIp } from "../../utils/environmentAccess";

const ACCESS_TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60; // matches the 180d JWE minted by WrikeTokenExchange
const AUTH_CODE_TTL = "60s";

const isLoopback = (urlString) => {
  try {
    const { hostname } = new URL(urlString);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
};

const isHttps = (urlString) => {
  try {
    return new URL(urlString).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Resolve the redirect_uris a client_id is allowed to use.
 * client_id is a signed JWT minted by /oauth/register embedding { redirect_uris }.
 * Returns null if client_id is absent/unverifiable (caller falls back to loopback-only).
 */
const resolveRegisteredRedirectUris = (fastify, clientId) => {
  if (!clientId) return null;
  try {
    const decoded = fastify.jwt.verify(clientId);
    return Array.isArray(decoded.redirect_uris) ? decoded.redirect_uris : null;
  } catch {
    return null;
  }
};

const renderEnvironmentPicker = ({ visibleCreds, query }) => {
  const hiddenFields = Object.entries(query)
    .filter(([key]) => key !== "environment_id" && key !== "environmentId")
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${key}" value="${String(value ?? "").replace(/"/g, "&quot;")}">`,
    )
    .join("\n");

  const options = Object.entries(visibleCreds || {})
    .map(([envName, envData]) => `<option value="${envData.id}">${envName}</option>`)
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Connect to WrikeXPI</title>
  <link rel="icon" href="https://cdn.wrike.com/static/branding/wrike/favicons/favicon.ico">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', sans-serif;
      height: 100vh;
      background: linear-gradient(-45deg, #1f1c2c, #928dab, #2e2e52, #515175);
      background-size: 400% 400%;
      animation: gradient 15s ease infinite;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
    }
    @keyframes gradient {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    .card {
      backdrop-filter: blur(16px);
      background-color: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 24px;
      padding: 50px 40px;
      max-width: 400px;
      width: 90%;
      text-align: center;
    }
    h1 { font-size: 1.5rem; margin-bottom: 12px; }
    p { font-size: 0.9rem; color: #cccccc; margin-bottom: 24px; }
    .env-select-wrapper { width: 100%; margin-bottom: 20px; text-align: left; }
    .env-select-label { display: block; margin-bottom: 8px; color: #e2e8f0; font-size: 0.95rem; font-weight: 600; }
    .env-select {
      width: 100%;
      padding: 10px 12px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.35);
      background: rgba(255, 255, 255, 0.15);
      color: #e2e8f0;
      font-size: 0.95rem;
    }
    .env-select option { color: #0f172a; background: rgba(255,255,255,0.95); }
    button {
      width: 100%;
      padding: 14px 26px;
      font-size: 1rem;
      font-weight: 600;
      color: white;
      background: #4CAF50;
      border: none;
      border-radius: 12px;
      cursor: pointer;
    }
    button:hover { background: #45a049; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect an MCP client to WrikeXPI</h1>
    <p>Choose which Wrike environment this connection should use.</p>
    <form method="GET" action="/oauth/authorize">
      ${hiddenFields}
      <div class="env-select-wrapper">
        <label for="envSelect" class="env-select-label">Choose Environment</label>
        <select id="envSelect" name="environment_id" class="env-select" required>
          <option value="" disabled selected>Select an environment</option>
          ${options}
        </select>
      </div>
      <button type="submit">Continue</button>
    </form>
  </div>
</body>
</html>`;
};

export const oauthRoute = (fastify, opts, done) => {
  // MCP token requests are typically application/x-www-form-urlencoded; scope
  // a parser to this plugin only (no global body-parsing change).
  fastify.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (req, body, cb) => {
      try {
        cb(null, Object.fromEntries(new URLSearchParams(body)));
      } catch (err) {
        cb(err);
      }
    },
  );

  fastify.get("/authorize", async (req, reply) => {
    try {
      const {
        response_type,
        client_id,
        redirect_uri,
        state,
        code_challenge,
        code_challenge_method,
        environment_id,
        environment,
        accountId,
      } = req.query;

      if (!redirect_uri) {
        return reply
          .code(400)
          .send({ error: "invalid_request", error_description: "redirect_uri is required" });
      }
      if (response_type && response_type !== "code") {
        return reply
          .code(400)
          .send({ error: "unsupported_response_type" });
      }
      if (!code_challenge || code_challenge_method !== "S256") {
        return reply.code(400).send({
          error: "invalid_request",
          error_description: "PKCE (code_challenge + code_challenge_method=S256) is required",
        });
      }

      const allowedRedirects = resolveRegisteredRedirectUris(fastify, client_id);
      if (allowedRedirects) {
        if (!allowedRedirects.includes(redirect_uri)) {
          return reply.code(400).send({
            error: "invalid_request",
            error_description: "redirect_uri is not registered for this client_id",
          });
        }
      } else if (!isLoopback(redirect_uri)) {
        return reply.code(400).send({
          error: "invalid_request",
          error_description:
            "Unregistered clients must use a loopback (127.0.0.1/localhost) redirect_uri",
        });
      }

      const visibleCreds = getCachedVisibleWrikeCredentials();

      if (!environment_id) {
        return reply
          .type("text/html")
          .send(renderEnvironmentPicker({ visibleCreds, query: req.query }));
      }

      const knownEnv = Object.values(visibleCreds || {}).find(
        (c) => String(c.id) === String(environment_id),
      );
      if (!knownEnv) {
        return reply.code(400).send({
          error: "invalid_request",
          error_description: `Unknown environment_id: ${environment_id}`,
        });
      }

      const { redirectUrl } = findRedirectionURL(
        {
          environmentId: environment_id,
          environment,
          redirectUri: redirect_uri,
          accountId,
          extra: {
            code_challenge,
            code_challenge_method,
            client_state: state,
            client_id: client_id || null,
          },
        },
        fastify,
      );

      return reply.redirect(redirectUrl);
    } catch (err) {
      return reply.code(400).send({
        error: "server_error",
        error_description: err?.message || "Failed to start authorization",
      });
    }
  });

  fastify.post("/token", async (req, reply) => {
    try {
      const body = req.body || {};
      const { grant_type } = body;

      if (grant_type === "authorization_code") {
        const { code, code_verifier, redirect_uri } = body;
        if (!code || !code_verifier) {
          return reply.code(400).send({ error: "invalid_request" });
        }

        let decoded;
        try {
          decoded = fastify.jwt.verify(code);
        } catch {
          return reply.code(400).send({
            error: "invalid_grant",
            error_description: "Authorization code is invalid or expired",
          });
        }

        if (redirect_uri && decoded.redirect_uri && redirect_uri !== decoded.redirect_uri) {
          return reply.code(400).send({
            error: "invalid_grant",
            error_description: "redirect_uri does not match the one used at /authorize",
          });
        }

        const computedChallenge = crypto
          .createHash("sha256")
          .update(code_verifier)
          .digest("base64url");
        if (computedChallenge !== decoded.code_challenge) {
          return reply.code(400).send({
            error: "invalid_grant",
            error_description: "PKCE verification failed",
          });
        }

        const result = await WrikeTokenExchange(
          {
            code: decoded.wrikeCode,
            environmentId: decoded.environmentId,
            ip: clientIp(req),
          },
          fastify,
        );

        return reply.code(200).send({
          access_token: result.token,
          token_type: "Bearer",
          expires_in: ACCESS_TOKEN_TTL_SECONDS,
        });
      }

      if (grant_type === "refresh_token") {
        const { refresh_token } = body;
        if (!refresh_token) {
          return reply.code(400).send({ error: "invalid_request" });
        }
        try {
          // Re-validates (and, if near expiry, transparently refreshes the
          // underlying Wrike token server-side) — see authentication.js resolveAuth().
          await ResolveAuthFromJWT(refresh_token);
        } catch {
          return reply.code(400).send({ error: "invalid_grant" });
        }

        // The JWE is its own refresh handle: it already self-refreshes the
        // underlying Wrike access token server-side, so no separate refresh
        // token needs to be minted — we just echo it back with a fresh TTL.
        return reply.code(200).send({
          access_token: refresh_token,
          token_type: "Bearer",
          expires_in: ACCESS_TOKEN_TTL_SECONDS,
        });
      }

      return reply.code(400).send({ error: "unsupported_grant_type" });
    } catch (err) {
      if (err?.statusCode === 403) {
        // Environment allow list rejected this caller (see
        // WrikeTokenExchange -> evaluateAccess) — a real OAuth2 error code,
        // not a malformed/expired grant.
        return reply.code(403).send({
          error: "access_denied",
          error_description: err?.message || "Access denied for this environment",
        });
      }
      return reply.code(400).send({
        error: "invalid_grant",
        error_description: err?.message || "Token exchange failed",
      });
    }
  });

  fastify.post("/register", async (req, reply) => {
    const { redirect_uris, client_name } = req.body || {};

    if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return reply.code(400).send({
        error: "invalid_client_metadata",
        error_description: "redirect_uris is required and must be a non-empty array",
      });
    }

    for (const uri of redirect_uris) {
      if (!isLoopback(uri) && !isHttps(uri)) {
        return reply.code(400).send({
          error: "invalid_redirect_uri",
          error_description: `redirect_uri must be loopback (127.0.0.1/localhost) or https: ${uri}`,
        });
      }
    }

    // Stateless DCR: client_id is a signed JWT embedding the registered
    // redirect_uris — verified later at /authorize and /token, no DB row.
    const client_id = fastify.jwt.sign(
      { redirect_uris, client_name: client_name || null },
      { expiresIn: "3650d" },
    );

    return reply.code(201).send({
      client_id,
      redirect_uris,
      client_name: client_name || undefined,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  done();
};

export default oauthRoute;
