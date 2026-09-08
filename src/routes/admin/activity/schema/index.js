export const ListSchema = {
  schema: {
    querystring: {
      type: "object",
      properties: {
        env_id: { type: "string", format: "uuid" },
        actor_email: { type: "string", maxLength: 320 },
        surface: { type: "string", enum: ["rest", "mcp"] },
        allowed: { type: "string", enum: ["true", "false"] },
        from: { type: "string" },
        to: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
        offset: { type: "integer", minimum: 0 },
      },
    },
  },
};

export const SummarySchema = {
  schema: {
    querystring: {
      type: "object",
      properties: {
        env_id: { type: "string", format: "uuid" },
        since: { type: "string" },
      },
    },
  },
};
