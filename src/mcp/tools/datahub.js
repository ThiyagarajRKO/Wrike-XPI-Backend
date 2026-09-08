import { z } from "zod";
import { getDatahubCustomFields } from "../../utils/wrike";
import { getAuthError } from "./auth.js";

const normalizeFieldMap = (fieldMapping = {}) => {
  if (!fieldMapping || typeof fieldMapping !== "object") return {};
  const normalized = {};
  Object.entries(fieldMapping).forEach(([key, value]) => {
    const fieldKey = String(key || "")
      .trim()
      .toLowerCase();
    if (!fieldKey) return;
    normalized[fieldKey] = { ...(value || {}), rawKey: key };
  });
  return normalized;
};

/**
 * Register the Datahub field discovery tool on the given server instance.
 * This tool exposes the field mapping metadata that agents use to resolve
 * friendly field names to the correct internal identifiers before calling
 * campaign, channel, or task CRUD tools.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {string} serverUrl
 * @param {{wrikeToken: string, environmentName: string}} auth
 */
export const registerDatahubTools = (server, serverUrl, auth) => {
  server.registerTool(
    "datahub_list_fields",

    {
      description:
        "Return the Datahub field mapping metadata for campaign, channel, and task CRUD tools. " +
        "Agents should call this FIRST to discover valid field keys and their properties " +
        "(isCampaignField, isChannelField, isTaskField, isWritable, isReadable) before " +
        "invoking update or create operations. The `key` values returned here are EXACTLY " +
        "the keys to use in: (1) update/create formFields (e.g. { agency: 'X' }), and " +
        "(2) list filter expressions. Wrike-native (wrike_*) tools do NOT understand these " +
        "XPI keys — use them with the XPI campaign/channel/task/datahub tools only.",
      inputSchema: {
        includeMetadata: z
          .boolean()
          .optional()
          .describe("Include raw metadata alongside field definitions"),
      },
      annotations: {
        title: "List Datahub Fields",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ includeMetadata }, extra) => {
      if (!auth) return getAuthError(serverUrl);

      try {
        const fieldMapping = await getDatahubCustomFields(
          auth.wrikeToken,
          null,
          false,
          true,
          null,
          auth.environmentName,
        );
        const normalizedFieldMap = normalizeFieldMap(fieldMapping);

        const fields = Object.entries(normalizedFieldMap).map(
          ([key, value]) => ({
            key,
            cfId: value?.cfId,
            isCampaignField: value?.isCampaignField,
            isChannelField: value?.isChannelField,
            isTaskField: value?.isTaskField,
            isWritable: value?.isWritable,
            isReadable: value?.isReadable,
            xpiFieldType: value?.xpiFieldType,
            description: value?.description,
          }),
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message:
                    "Field metadata resolved via the Datahub custom field mapping API.",
                  count: fields.length,
                  data: fields,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        throw new Error(err?.message || "Failed to list Datahub custom fields");
      }
    },
  );
};
