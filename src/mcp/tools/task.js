import { z } from "zod";
import { GetAllTasks } from "../../routes/task/handlers/getAllTasks";
import { GetTask } from "../../routes/task/handlers/getTask";
import { UpdateTask } from "../../routes/task/handlers/updateTask";
import { DeleteTask } from "../../routes/task/handlers/deleteTask";
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
 * Register all task-related MCP tools on the given server instance.
 * Auth is resolved once per HTTP request (see src/plugins/mcp.js) and passed in.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {string} serverUrl
 * @param {{wrikeToken: string, environmentName: string}} auth
 */
export const registerTaskTools = (server, serverUrl, auth) => {
  server.registerTool(
    "task_list_channel",
    {
      description:
        "List the XPI tasks under a channel (Wrike task children of an XPI channel). " +
        "Returns each task's readable Datahub fields keyed by their XPI SHORT CODES " +
        "(see datahub_list_fields, isTaskField=true), with Datahub-linked values " +
        "translated to friendly names.\n\n" +
        "FILTER SYNTAX (OData):\n" +
        "  Operators: eq, ne, lt, le, gt, ge, startswith, endswith, has\n" +
        "  Values in single quotes.\n" +
        "  Example: (taskstatus eq 'In Progress')\n" +
        "  Field keys from datahub_list_fields where isTaskField=true.\n\n" +
        "Prefer this over wrike_get_items_children / wrike_search_items when the ask is " +
        "XPI tasks inside an XPI channel flow and you want short-code fields; the wrike_* " +
        "alternatives return raw Wrike items with custom field IDs instead.",
      inputSchema: {
        channelId: z
          .string()
          .describe(
            "Wrike API v4 ID of the parent channel — an opaque id with NO fixed pattern " +
              "or length; may look like MQAAAAELy_uV, MQAAAAELyuV, or " +
              "IEAC7PRTI5OAO7EP (letters/digits, may include - or _). NOT the channel " +
              "name. Copy the exact id from a channel list/get result.",
          ),
        filter: z.string().optional().describe("OData filter expression"),
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
        title: "List Channel Tasks",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ channelId, filter, pageSize, nextPageToken }, extra) => {
      if (!auth) return getAuthError(serverUrl);
      try {
        const result = await GetAllTasks(
          auth.wrikeToken,
          { channelId, filter, pageSize, nextPageToken },
          "channel",
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
        throw new Error(err?.message || "Failed to list channel tasks");
      }
    },
  );

  server.registerTool(
    "task_list_campaign",
    {
      description:
        "List the XPI tasks under a campaign (Wrike task children of an XPI campaign). " +
        "Returns each task's readable Datahub fields keyed by their XPI SHORT CODES " +
        "(see datahub_list_fields, isTaskField=true), with Datahub-linked values " +
        "translated to friendly names.\n\n" +
        "FILTER PARAMETERS:\n" +
        "  Field names are the short codes from datahub_list_fields where isTaskField=true.\n" +
        "\n" +
        "  OPERATORS: eq, ne, lt, le, gt, ge, has, startswith, endswith\n" +
        "\n" +
        "  RULES:\n" +
        "    - String values must be in single quotes.\n" +
        "    - Multiple conditions use 'and' only (OR not supported).\n" +
        "    - Wrap expression in parentheses.\n" +
        "\n" +
        "  EXAMPLES:\n" +
        "    (taskstatus eq 'Completed')\n" +
        "    (taskstatus eq 'In Progress' and campaignname eq 'Campaign X')\n" +
        "    startswith(taskname, 'Q1')\n\n" +
        "Prefer this over wrike_get_items_children / wrike_search_items when the ask is " +
        "XPI tasks inside an XPI campaign flow and you want short-code fields; the wrike_* " +
        "alternatives return raw Wrike items with custom field IDs instead.",
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
            "OData filter expression. 'and' supported. OR not supported. Example: (taskstatus eq 'Completed' and campaignname eq 'Campaign Name')",
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
        title: "List Campaign Tasks",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ campaignId, filter, pageSize, nextPageToken }, extra) => {
      if (!auth) return getAuthError(serverUrl);
      try {
        const result = await GetAllTasks(
          auth.wrikeToken,
          { campaignId, filter, pageSize, nextPageToken },
          "campaign",
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
        throw new Error(err?.message || "Failed to list campaign tasks");
      }
    },
  );

  server.registerTool(
    "task_get",
    {
      description:
        "Read a single XPI task by its Wrike task ID. Validates the item is an XPI Task " +
        "(rejects non-task / rollup items) and returns the readable Datahub fields keyed " +
        "by XPI SHORT CODES (isTaskField=true), Datahub-linked values translated to " +
        "friendly names.\n\n" +
        "Prefer this over wrike_get_item_details when you know the task belongs to an XPI " +
        "campaign/channel flow and want short-code fields; use wrike_get_item_details for " +
        "a raw read of any Wrike item (any type, custom field IDs, no XPI mapping).",
      inputSchema: {
        taskId: z
          .string()
          .describe(
            "Wrike API v4 ID of the task — an opaque id with NO fixed pattern or length; " +
              "may look like MQAAAAELy_uV, MQAAAAELyuV, or IEAC7PRTI5OAO7EP " +
              "(letters/digits, may include - or _). NOT the task title. Copy the exact " +
              "id from a task list/get result.",
          ),
      },
      annotations: {
        title: "Get Task",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ taskId }, extra) => {
      if (!auth) return getAuthError(serverUrl);
      try {
        const result = await GetTask(
          auth.wrikeToken,
          { taskId },
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
        throw new Error(err?.message || "Failed to get task");
      }
    },
  );

  server.registerTool(
    "task_update",

    {
      description:
        "Update an XPI task by its Wrike task ID. Pass formFields keyed by the task " +
        "field SHORT CODES from datahub_list_fields (isTaskField=true), e.g. " +
        "{ taskstatus: 'In Progress' }. Only writable XPI task keys are applied; dates " +
        "must be YYYY-MM-DD; Datahub-linked values are translated automatically.\n\n" +
        "Prefer this over wrike_update_items for XPI task data — wrike_update_items " +
        "writes raw custom field IDs directly and bypasses XPI field mapping/validation.",
      inputSchema: {
        taskId: z
          .string()
          .describe(
            "Wrike API v4 ID of the task — an opaque id with NO fixed pattern or length; " +
              "may look like MQAAAAELy_uV, MQAAAAELyuV, or IEAC7PRTI5OAO7EP " +
              "(letters/digits, may include - or _). NOT the task title. Copy the exact " +
              "id from a task list/get result.",
          ),
        formFields: z
          .record(z.any())
          .default({})
          .describe("Key-value map of field names to new values"),
      },
      annotations: {
        title: "Update Task",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ taskId, formFields }, extra) => {
      if (!auth) return getAuthError(serverUrl);
      try {
        const result = await UpdateTask(
          auth.wrikeToken,
          { taskId, formFields },
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
        throw new Error(err?.message || "Failed to update task");
      }
    },
  );

  server.registerTool(
    "task_delete",

    {
      description:
        "Delete an XPI task by its Wrike task ID. This is the ONLY delete operation " +
        "exposed by this server — Wrike's own MCP tools do not provide a delete, so " +
        "do not look for a wrike_* delete alternative.",
      inputSchema: {
        taskId: z
          .string()
          .describe(
            "Wrike API v4 ID of the task — an opaque id with NO fixed pattern or length; " +
              "may look like MQAAAAELy_uV, MQAAAAELyuV, or IEAC7PRTI5OAO7EP " +
              "(letters/digits, may include - or _). NOT the task title. Copy the exact " +
              "id from a task list/get result.",
          ),
      },
      annotations: {
        title: "Delete Task",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ taskId }, extra) => {
      if (!auth) return getAuthError(serverUrl);
      try {
        const result = await DeleteTask(
          auth.wrikeToken,
          { taskId },
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
        throw new Error(err?.message || "Failed to delete task");
      }
    },
  );
};
