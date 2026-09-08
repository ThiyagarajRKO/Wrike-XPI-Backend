import { z } from "zod";
import { GetAllChannels } from "../../routes/channel/handlers/getAllChannels";
import { GetChannel } from "../../routes/channel/handlers/getChannel";
import { UpdateChannel } from "../../routes/channel/handlers/updateChannel";
import { DeleteChannel } from "../../routes/channel/handlers/deleteChannel";
import { getAuthError } from "./auth.js";

const serializeResult = (result) => {
  if (!result) return { success: true, data: null };
  if (typeof result === "object" && "statusCode" in result) {
    const { statusCode, ...rest } = result;
    return { success: statusCode < 400, statusCode, ...rest };
  }
  return result;
};

/**
 * Register all channel-related MCP tools on the given server instance.
 * Auth is resolved once per HTTP request (see src/plugins/mcp.js) and passed in.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {string} serverUrl
 * @param {{wrikeToken: string, environmentName: string}} auth
 */
export const registerChannelTools = (server, serverUrl, auth) => {
  server.registerTool(
    "channel_list",
    {
      description:
        "List channels for a campaign using the existing channel list workflow.\n\n" +
        "FILTER PARAMETERS:\n" +
        "  Field names are the short codes from datahub_list_fields where isChannelField=true.\n" +
        "\n" +
        "  OPERATORS: eq, ne, lt, le, gt, ge, has, startswith, endswith\n" +
        "\n" +
        "  RULES:\n" +
        "    - String values must be in single quotes.\n" +
        "    - Multiple conditions use 'and' only (OR not supported).\n" +
        "    - Wrap expression in parentheses.\n" +
        "\n" +
        "  EXAMPLES:\n" +
        "    (channelname eq 'TV Spot')\n" +
        "    (channelname eq 'TV Spot' and mediabuytype eq 'Programmatic')\n" +
        "    channelname has 'Digital'",
      inputSchema: {
        campaignId: z
          .string()
          .describe(
            "Wrike API v4 ID of the parent campaign — an opaque id with NO fixed pattern " +
              "or length; may look like MQAAAAELy_uV, MQAAAAELyuV, or " +
              "IEAC7PRTI5OAO7EP (letters/digits, may include - or _). NOT the campaign " +
              "name. Copy the exact id from a campaign list/get result.",
          ),
        filter: z
          .string()
          .optional()
          .describe(
            "OData filter expression. 'and' supported. OR not supported. Example: (channelname eq 'TV Spot' and mediabuytype eq 'Programmatic')",
          ),
        pageSize: z
          .number()
          .int()
          .optional()
          .describe("Number of results per page"),
        nextPageToken: z
          .string()
          .optional()
          .describe("Token for the next page of results"),
      },
      annotations: {
        title: "List Channels",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ campaignId, filter, pageSize, nextPageToken }, extra) => {
      if (!auth) return getAuthError(serverUrl);
      try {
        const result = await GetAllChannels(
          auth.wrikeToken,
          { campaignId, filter, pageSize, nextPageToken },
          auth.environmentName,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(serializeResult(result), null, 2),
            },
          ],
        };
      } catch (err) {
        throw new Error(err?.message || "Failed to list channels");
      }
    },
  );

  server.registerTool(
    "channel_get",

    {
      description: "Read a single channel by its Wrike task/folder ID.",
      inputSchema: {
        channelId: z
          .string()
          .describe(
            "Wrike API v4 ID of the channel — an opaque id with NO fixed pattern or " +
              "length; may look like MQAAAAELy_uV, MQAAAAELyuV, or IEAC7PRTI5OAO7EP " +
              "(letters/digits, may include - or _). NOT the channel name. Copy the " +
              "exact id from a list/get result.",
          ),
      },
      annotations: {
        title: "Get Channel",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ channelId }, extra) => {
      if (!auth) return getAuthError(serverUrl);
      try {
        const result = await GetChannel(
          auth.wrikeToken,
          { channelId },
          auth.environmentName,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(serializeResult(result), null, 2),
            },
          ],
        };
      } catch (err) {
        throw new Error(err?.message || "Failed to get channel");
      }
    },
  );

  server.registerTool(
    "channel_update",

    {
      description:
        "Update an XPI channel by its Wrike ID. Pass formFields keyed by the " +
        "channel field SHORT CODES from datahub_list_fields (isChannelField=" +
        "true), e.g. { channelname: 'TV Spot' }. Only writable keys are " +
        "applied; dates must be YYYY-MM-DD. Prefer this over wrike_update_items " +
        "for XPI channel data.",
      inputSchema: {
        channelId: z
          .string()
          .describe(
            "Wrike API v4 ID of the channel — an opaque id with NO fixed pattern or " +
              "length; may look like MQAAAAELy_uV, MQAAAAELyuV, or IEAC7PRTI5OAO7EP " +
              "(letters/digits, may include - or _). NOT the channel name. Copy the " +
              "exact id from a list/get result.",
          ),
        formFields: z
          .record(z.any())
          .default({})
          .describe("Key-value map of field names to new values"),
      },
      annotations: {
        title: "Update Channel",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ channelId, formFields }, extra) => {
      if (!auth) return getAuthError(serverUrl);
      try {
        const result = await UpdateChannel(
          auth.wrikeToken,
          { channelId, formFields },
          auth.environmentName,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(serializeResult(result), null, 2),
            },
          ],
        };
      } catch (err) {
        throw new Error(err?.message || "Failed to update channel");
      }
    },
  );

  server.registerTool(
    "channel_delete",

    {
      description: "Delete a channel by its Wrike ID.",
      inputSchema: {
        channelId: z
          .string()
          .describe(
            "Wrike API v4 ID of the channel — an opaque id with NO fixed pattern or " +
              "length; may look like MQAAAAELy_uV, MQAAAAELyuV, or IEAC7PRTI5OAO7EP " +
              "(letters/digits, may include - or _). NOT the channel name. Copy the " +
              "exact id from a list/get result.",
          ),
      },
      annotations: {
        title: "Delete Channel",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ channelId }, extra) => {
      if (!auth) return getAuthError(serverUrl);
      try {
        const result = await DeleteChannel(
          auth.wrikeToken,
          { channelId },
          auth.environmentName,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(serializeResult(result), null, 2),
            },
          ],
        };
      } catch (err) {
        throw new Error(err?.message || "Failed to delete channel");
      }
    },
  );
};
