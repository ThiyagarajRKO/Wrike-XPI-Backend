export const ToggleSchema = {
  schema: {
    params: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
      },
    },
    body: {
      type: "object",
      // At least one switch — enforced in the handler, since JSON Schema's
      // anyOf-of-required reads worse than a one-line runtime check.
      properties: {
        is_active: { type: "boolean" },
        is_visible: { type: "boolean" },
        allowlist_check_enabled: { type: "boolean" },
        custom_field_check_enabled: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
};
