import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCampaignTools } from "./tools/campaign.js";
import { registerChannelTools } from "./tools/channel.js";
import { registerTaskTools } from "./tools/task.js";
import { registerDatahubTools } from "./tools/datahub.js";
import { registerWrikeProxyTools } from "./wrikeMcpProxy.js";
import { applyToolAuthorization } from "./toolGuard.js";
import wrikeIconDataUri from "./wrikeIcon.js";

/**
 * Create a fully-configured MCP server with all tools registered.
 * Authentication is resolved once per HTTP request (bearer token, see
 * src/plugins/mcp.js) and passed in as `auth` — tools no longer accept
 * an auth_token parameter of their own.
 *
 * @param {object} fastify - Fastify instance
 * @param {string} serverUrl - Base URL for auth error messages
 * @param {{wrikeToken: string, environmentName: string}} auth - Resolved auth for this request
 * @returns {Promise<McpServer>}
 */
export const createMcpServer = async (fastify, serverUrl, auth) => {
  const server = new McpServer(
    {
      name: "wrikexpi-mcp",
      title: "WrikeXPI",
      version: "1.0.0",
      description: "Manage Wrike XPI campaigns, channels, tasks, and Datahub fields.",
      websiteUrl: serverUrl,
      icons: [
        {
          src: wrikeIconDataUri,
          mimeType: "image/x-icon",
        },
      ],
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Must precede every registerTool() below — it wraps the registration
  // function itself so each tool is checked against the caller's CRUD grant.
  // auth.access is resolved once per request in src/plugins/mcp.js.
  applyToolAuthorization(server, auth?.access);

  registerCampaignTools(server, fastify, serverUrl, auth);
  registerChannelTools(server, serverUrl, auth);
  registerTaskTools(server, serverUrl, auth);
  registerDatahubTools(server, serverUrl, auth);

  // Merges in Wrike's own hosted MCP tools (no-ops if WRIKE_MCP_URL is unset
  // or unreachable — native XPI tools above are unaffected either way).
  if (auth?.wrikeToken) {
    await registerWrikeProxyTools(server, fastify, auth.wrikeToken);
  }

  return server;
};
