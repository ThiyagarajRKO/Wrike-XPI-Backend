import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCampaignTools } from "./tools/campaign.js";
import { registerChannelTools } from "./tools/channel.js";
import { registerTaskTools } from "./tools/task.js";
import { registerDatahubTools } from "./tools/datahub.js";
import { registerWrikeProxyTools } from "./wrikeMcpProxy.js";
import wrikeIconDataUri from "./wrikeIcon.js";

/**
 * Top-level instructions surfaced to the connected agent during handshake.
 *
 * This server now merges TWO tool families — native XPI business tools and
 * Wrike's own hosted MCP tools (proxied with a `wrike_` prefix). The
 * guidance tells the agent which family to reach for, so the two never
 * conflict and it always has enough context to pick the right tool.
 */
const MCP_INSTRUCTIONS = `You are connected to the WrikeXPI MCP server. This server exposes TWO tool families that complement — not duplicate — each other.

1. NATIVE XPI TOOLS (no prefix)
   Business operations for WrikeXPI-managed resources: campaigns, channels, tasks, and Datahub records/fields. They are scoped to the environment of your authenticated token and apply XPI rules (enrichment, validation, request forms, datahub IDs) on top of Wrike.
   Prefer these whenever the user is talking about an XPI resource: a campaign, a channel, a Datahub field/record, or a task that belongs to an XPI campaign/channel flow.

2. WRIKE NATIVE TOOLS (prefix "wrike_", present only when reachable for this token)
   Wrike's own MCP tools, proxied one-to-one, operating on the raw Wrike account. Real tool families: items & hierarchy (search_items, get_item_details, get_items_children, create_task_item, create_project_folder_item, update_items), spaces (search_spaces), approvals (get_approvals, search_approvals), comments (get_item_comments, create_item_comment), inbox (get_my_inbox), users & groups (get_users, search_users), custom item types & custom fields (search_customitemtypes, search_item_customfields), workflows/statuses (search_workflows), and attachments (prepare_attachment_upload, add_attachments_to_item).
   Use these when the ask concerns raw Wrike objects that XPI tools do not model — comments, approvals, inbox, spaces, users/groups, attachments, generic item search/hierarchy, custom item types, workflows/statuses — or to read/update an item that lives outside an XPI flow.

HOW TO CHOOSE — avoid conflict
- Let the resource decide the family, not the tool list: XPI-managed resource -> XPI tool; a generic Wrike item/space/user/approval/comment/etc. -> wrike_* tool.
- Never call an XPI tool and a wrike_* tool for the same job, and never invent a combined flow when a single call does it.
- If an expected wrike_* tool is missing, fall back to the XPI toolset (always present) or tell the user it is unavailable — do not improvise a substitute.

MECHANICS
- Authentication is already resolved per request; never pass tokens or credentials.
- Read each tool's schema before calling; arguments are validated.
- IDs returned by tools feed into the matching tools unchanged (XPI IDs are Wrike-based; wrike_* tools accept Wrike item/folder/task IDs).
- If the user gives you a Wrike link instead of an ID (a permalink such as https://www.wrike.com/open.htm?id=... or https://app-eu.wrike.com/open.htm?id=...), do not parse or guess the ID from the URL yourself. Pass the permalink itself into get_item_details. The response's id field is the resolved v4 ID for that folder or task. Use that v4 ID for every following call, including native XPI tools.
- Respect limits and pagination: wrike_* tools cap results (e.g. 200 newest comments, pageSize on search_items) and return truncation/next-page signals — page through or narrow the query as each tool's description explains.`;

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
      description:
        "Hybrid WrikeXPI MCP: native XPI business tools (campaigns, channels, tasks, Datahub) + Wrike's own tools exposed as wrike_*.",
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
      instructions: MCP_INSTRUCTIONS,
    },
  );

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
