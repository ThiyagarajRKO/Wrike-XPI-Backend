import { z } from "zod";
import { GetAllCampaigns } from "../../routes/campaign/handlers/getAllCampaigns";
import { GetCampaign } from "../../routes/campaign/handlers/getCampaign";
import { CreateCampaign } from "../../routes/campaign/handlers/createCampaign";
import { UpdateCampaign } from "../../routes/campaign/handlers/updateCampaign";
import { DeleteCampaign } from "../../routes/campaign/handlers/deleteCampaign";
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
 * Register all campaign-related MCP tools on the given server instance.
 * Auth is resolved once per HTTP request (see src/plugins/mcp.js) and passed in.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {object} fastify
 * @param {string} serverUrl
 * @param {{wrikeToken: string, environmentName: string}} auth
 */
export const registerCampaignTools = (server, fastify, serverUrl, auth) => {
  server.registerTool(
    "campaign_list",

    {
      description:
        "List campaigns using the existing campaign API logic. " +
        "Supports OData-style filters and pagination.\n\n" +
        "FILTER PARAMETERS:\n" +
        "  Field names are the short codes returned by datahub_list_fields (e.g. agency, campaignname, campaignbudget, brand, client).\n" +
        "\n" +
        "  OPERATORS:\n" +
        "    eq         – equals\n" +
        "    ne         – not equal\n" +
        "    lt / le    – less than / less or equal\n" +
        "    gt / ge    – greater than / greater or equal\n" +
        "    has        – contains (substring match)\n" +
        "    startswith – starts with a value\n" +
        "    endswith   – ends with a value\n" +
        "\n" +
        "  IMPORTANT:\n" +
        "    - String values MUST be wrapped in single quotes.\n" +
        "    - Multiple conditions are combined with 'and' only (OR is NOT supported).\n" +
        "    - Always wrap the full expression in parentheses.\n" +
        "    - Numeric values (budget, dates) can be compared with lt/le/gt/ge without quotes.\n" +
        "    - 'has' is an operator (field has 'value'); do NOT write has(field, 'value').\n" +
        "    - 'contains(...)' is NOT supported.\n" +
        "\n" +
        "  EXAMPLES:\n" +
        "    Single condition:\n" +
        "      (agency eq 'EssenceMediacom')\n" +
        "\n" +
        "    Multiple AND conditions:\n" +
        "      (agency eq 'EssenceMediacom' and campaignname eq 'Lacer - Pilexil - AO Diciembre')\n" +
        "\n" +
        "    Method call-style:\n" +
        "      startswith(campaignname, 'Industry')\n" +
        "\n" +
        "    Contains (substring):\n" +
        "      campaignname has 'Fidelity'\n" +
        "\n" +
        "    Numeric comparison:\n" +
        "      (campaignbudget gt 1000)\n" +
        "\n" +
        "  URL equivalent: filter=(agency eq 'EssenceMediacom' and campaignname eq 'Lacer - Pilexil - AO Diciembre')&pageSize=5",
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe(
            "OData filter expression. Use 'and' to combine conditions. OR not supported. " +
              "Example: (agency eq 'EssenceMediacom' and campaignname eq 'Campaign Name'). " +
              "Field names are the short codes from datahub_list_fields.",
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
        title: "List Campaigns",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ filter, pageSize, nextPageToken }, extra) => {
      if (!auth) return getAuthError(serverUrl);
      try {
        const result = await GetAllCampaigns(
          auth.wrikeToken,
          { filter, pageSize, nextPageToken },
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
        throw new Error(err?.message || "Failed to list campaigns");
      }
    },
  );

  server.registerTool(
    "campaign_get",

    {
      description: "Read a single campaign by its Wrike folder ID.",
      inputSchema: {
        campaignId: z
          .string()
          .describe(
            "Wrike API v4 ID of the campaign — an opaque id with NO fixed pattern or " +
              "length; may look like MQAAAAELy_uV, MQAAAAELyuV, or IEAC7PRTI5OAO7EP " +
              "(letters/digits, may include - or _). NOT the campaign name. Copy the " +
              "exact id from a list/get result.",
          ),
      },
      annotations: {
        title: "Get Campaign",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ campaignId }, extra) => {
      if (!auth) return getAuthError(serverUrl);
      try {
        const result = await GetCampaign(
          auth.wrikeToken,
          { campaignId },
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
        throw new Error(err?.message || "Failed to get campaign");
      }
    },
  );

  server.registerTool(
    "campaign_create",

    {
      description:
        "Create an XPI campaign via the environment's Wrike request-form workflow " +
        "(NOT a raw Wrike folder create — prefer this over wrike_create_project_folder_item " +
        "when the goal is an XPI campaign).\n\n" +
        "  Required:\n" +
        "    space      – Wrike space id that owns the campaign request form\n" +
        "    entity     – the request-form entity/type configured for campaigns\n" +
        "    variantId  – the request-form variant id to submit against\n" +
        "  Optional:\n" +
        "    fields          – campaign field values (see datahub_list_fields for valid keys)\n" +
        "    isCreatedByURL  – true returns a pre-fill URL instead of submitting",
      inputSchema: {
        space: z.string().describe("Wrike space identifier"),
        entity: z.string().describe("Entity type for the request form"),
        variantId: z.number().int().describe("Variant ID for the request form"),
        fields: z
          .record(z.any())
          .optional()
          .describe("Field values for the campaign request form"),
        isCreatedByURL: z
          .boolean()
          .optional()
          .describe("If true, returns a pre-fill URL instead of submitting"),
      },
      annotations: {
        title: "Create Campaign",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ space, entity, variantId, fields, isCreatedByURL }, extra) => {
      if (!auth) return getAuthError(serverUrl);
      try {
        const result = await CreateCampaign(
          auth.wrikeToken,
          {
            space,
            entity,
            variantId,
            fields: fields || {},
            isCreatedByURL: !!isCreatedByURL,
          },
          fastify,
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
        throw new Error(err?.message || "Failed to create campaign");
      }
    },
  );

  server.registerTool(
    "campaign_update",

    {
      description:
        "Update an XPI campaign (Wrike folder) by its Wrike folder ID. " +
        "Pass formFields keyed by the campaign field SHORT CODES from " +
        "datahub_list_fields (isCampaignField=true), e.g. " +
        "{ campaignbudget: 50000, campaignenddate: '2026-12-31' }. Only keys " +
        "marked isWritable are applied; Datahub-linked custom fields are " +
        "resolved to record ids automatically; dates must be YYYY-MM-DD. " +
        "Prefer this over wrike_update_items for XPI campaign data.",
      inputSchema: {
        campaignId: z
          .string()
          .describe(
            "Wrike API v4 ID of the campaign — an opaque id with NO fixed pattern or " +
              "length; may look like MQAAAAELy_uV, MQAAAAELyuV, or IEAC7PRTI5OAO7EP " +
              "(letters/digits, may include - or _). NOT the campaign name. Copy the " +
              "exact id from a list/get result.",
          ),
        formFields: z
          .record(z.any())
          .default({})
          .describe("Key-value map of field names to new values"),
      },
      annotations: {
        title: "Update Campaign",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ campaignId, formFields }, extra) => {
      if (!auth) return getAuthError(serverUrl);
      try {
        const result = await UpdateCampaign(
          auth.wrikeToken,
          { campaignId, formFields },
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
        throw new Error(err?.message || "Failed to update campaign");
      }
    },
  );

  server.registerTool(
    "campaign_delete",

    {
      description: "Delete a campaign by its Wrike folder ID.",
      inputSchema: {
        campaignId: z
          .string()
          .describe(
            "Wrike API v4 ID of the campaign — an opaque id with NO fixed pattern or " +
              "length; may look like MQAAAAELy_uV, MQAAAAELyuV, or IEAC7PRTI5OAO7EP " +
              "(letters/digits, may include - or _). NOT the campaign name. Copy the " +
              "exact id from a list/get result.",
          ),
      },
      annotations: {
        title: "Delete Campaign",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ campaignId }, extra) => {
      if (!auth) return getAuthError(serverUrl);
      try {
        const result = await DeleteCampaign(
          auth.wrikeToken,
          { campaignId },
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
        throw new Error(err?.message || "Failed to delete campaign");
      }
    },
  );
};
