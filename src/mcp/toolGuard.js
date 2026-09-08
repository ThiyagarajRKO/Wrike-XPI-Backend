import { actionForTool } from "../utils/accessControl";

/**
 * Per-tool authorization for the MCP server.
 *
 * The allow list and the Xtend API flag are settled once per HTTP request, at
 * connect time (src/plugins/mcp.js) — a caller who fails either never gets a
 * server at all. What's left is the CRUD grant, which is per tool, so it is
 * enforced here by wrapping every handler as it registers.
 *
 * Wrapping registerTool rather than editing each tool file means a tool added
 * later is governed by default. Forgetting to add a permission check to a new
 * tool is exactly the kind of omission that should be impossible rather than
 * merely discouraged.
 */

const deniedResponse = ({ toolName, action, decision }) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(
        {
          success: false,
          error: "PERMISSION_DENIED",
          message:
            `You do not have "${action}" permission in the ` +
            `"${decision.environmentName || "this"}" environment, so ` +
            `${toolName} cannot be run.`,
          identity: decision.email || null,
          granted: Object.entries(decision.permissions || {})
            .filter(([, allowed]) => allowed)
            .map(([name]) => name),
          action:
            "Ask a WrikeXPI administrator to grant this permission in " +
            "Admin → API Access → Permissions. No retry will succeed until " +
            "they do.",
        },
        null,
        2,
      ),
    },
  ],
  isError: true,
});

/**
 * Install the guard on an McpServer. Call before any registerTool().
 *
 * @param {object} server   McpServer instance
 * @param {object} decision Resolved access decision for this request
 */
export const applyToolAuthorization = (server, decision) => {
  // No resolved decision means authorization did not run. That is a bug, not
  // a licence — deny everything rather than registering tools unguarded.
  const resolved = decision || {
    code: "AUTHORIZATION_MISSING",
    message: "Access was never evaluated for this connection.",
    permissions: {},
  };

  const originalRegisterTool = server.registerTool.bind(server);

  server.registerTool = (name, config, handler) => {
    const action = actionForTool(name, config?.annotations);

    const guarded = async (...args) => {
      if (!resolved.permissions?.[action]) {
        return deniedResponse({ toolName: name, action, decision: resolved });
      }
      return handler(...args);
    };

    return originalRegisterTool(name, config, guarded);
  };

  return server;
};

/**
 * A caller who fails the allow list or the Xtend API gate gets no tools at
 * all, so the refusal has to be delivered as an HTTP 401/403 body instead.
 * Shaped like the REST denial (src/middlewares/apiAuthorization.js) so both
 * surfaces explain a refusal the same way.
 */
export const connectionDenialBody = (decision) => ({
  error: "forbidden",
  error_description: decision.message,
  code: decision.code,
  checks: (decision.gates || []).map((g) => ({
    check: g.label,
    status: g.status,
    detail: g.detail,
  })),
});
