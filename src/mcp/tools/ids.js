import { z } from "zod";
import { convertLegacyIds } from "../../utils/wrike.js";
import { getAuthError } from "./auth.js";

const LEGACY_ID_TYPES = [
  "ApiV2Task",
  "ApiV2Attachment",
  "ApiV2Comment",
  "ApiV2Folder",
  "ApiV2Timelog",
  "ApiV2User",
  "ApiV2Account",
  "ApiV2RequestForm",
];

const MAX_IDS_PER_CALL = 1000;

/**
 * Register the legacy API v2 -> v4 ID converter tool on the given server
 * instance. Auth is resolved once per HTTP request (see src/plugins/mcp.js)
 * and passed in.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {string} serverUrl
 * @param {{wrikeToken: string, environmentName: string}} auth
 */
export const registerIdsTools = (server, serverUrl, auth) => {
  server.registerTool(
    "ids_convert",

    {
      description:
        "Convert legacy Wrike API v2 IDs (the short numeric-looking IDs used by old " +
        "integrations, imports, and API v2 links) into API v4 IDs — the opaque " +
        "alphanumeric IDs (e.g. MQAAAAELy_uV, IEAC7PRTI5OAO7EP) this server's other " +
        "tools require.\n\n" +
        "WHY THIS MATTERS: campaign_get / campaign_update / campaign_delete, " +
        "channel_get / channel_update / channel_delete, task_get / task_update / " +
        "task_delete, and task_list_campaign / task_list_channel (campaignId / " +
        "channelId / taskId parameters) all require a v4 ID. If you only have a " +
        "legacy v2 ID (a short numeric id, or one sourced from an old API v2 " +
        "integration/export), call this tool FIRST to resolve it to the matching " +
        "v4 ID, then pass that v4 ID into the campaign/channel/task tool.\n\n" +
        "INPUT:\n" +
        "  type – the entity type the ids belong to. One of:\n" +
        "    ApiV2Task         – tasks (feeds task_get/task_update/task_delete taskId)\n" +
        "    ApiV2Folder       – folders/projects, including campaigns and channels " +
        "(feeds campaign_get/campaign_update/campaign_delete campaignId, and " +
        "channel_get/channel_update/channel_delete channelId)\n" +
        "    ApiV2Attachment   – attachments\n" +
        "    ApiV2Comment      – comments\n" +
        "    ApiV2Timelog      – time tracking entries\n" +
        "    ApiV2User         – users or groups\n" +
        "    ApiV2Account      – accounts\n" +
        "    ApiV2RequestForm  – request forms\n" +
        "  ids – array of legacy API v2 ID strings to convert. Up to 1000 per call; " +
        "batch larger sets across multiple calls.\n\n" +
        "OUTPUT: an array of { id, apiV2Id } pairs, one per input id that Wrike could " +
        "resolve — `id` is the resulting API v4 ID, `apiV2Id` is the legacy id you " +
        "passed in (echoed back so you can match results to inputs). IDs that could not " +
        "be resolved (unknown, deleted, or not visible to this token) are simply " +
        "omitted from the result, not returned as errors.",
      inputSchema: {
        type: z
          .enum(LEGACY_ID_TYPES)
          .describe(
            "Entity type of the legacy IDs being converted. Use ApiV2Folder for " +
              "campaigns and channels, ApiV2Task for tasks.",
          ),
        ids: z
          .array(z.string())
          .min(1)
          .max(MAX_IDS_PER_CALL)
          .describe(
            `List of legacy API v2 IDs to convert to API v4 IDs. Max ${MAX_IDS_PER_CALL} per call.`,
          ),
      },
      annotations: {
        title: "Convert Legacy IDs",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ type, ids }, extra) => {
      if (!auth) return getAuthError(serverUrl);
      try {
        const result = await convertLegacyIds(auth.wrikeToken, type, ids);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { success: true, data: result?.data ?? [] },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        throw new Error(err?.message || "Failed to convert legacy IDs");
      }
    },
  );
};
