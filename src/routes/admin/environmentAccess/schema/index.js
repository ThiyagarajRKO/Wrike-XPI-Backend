const EMAIL_PATTERN = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

const RULE_TYPES = ["email", "domain", "ip"];

// Which surface an entry governs. "both" is the default, so an entry added
// without naming a surface behaves exactly as entries did before this existed.
const APPLIES_TO = ["api", "mcp", "both"];

// The surface the check simulator should evaluate against.
const SURFACES = ["api", "mcp"];

export const CreateRuleSchema = {
  schema: {
    body: {
      type: "object",
      required: ["env_id", "rule_type", "value"],
      properties: {
        env_id: { type: "string", format: "uuid" },
        rule_type: { type: "string", enum: RULE_TYPES },
        // Format differs by rule_type (email vs. domain vs. IP/CIDR), which
        // JSON Schema can't express as a dependency cleanly — the handler
        // validates against rule_type via environmentAccess.validateRuleValue.
        value: { type: "string", minLength: 1, maxLength: 255 },
        label: { type: "string", maxLength: 255, nullable: true },
        applies_to: { type: "string", enum: APPLIES_TO },
        is_enabled: { type: "boolean" },
      },
    },
  },
};

export const UpdateRuleSchema = {
  schema: {
    params: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", format: "uuid" } },
    },
    body: {
      type: "object",
      properties: {
        value: { type: "string", minLength: 1, maxLength: 255 },
        label: { type: "string", maxLength: 255, nullable: true },
        applies_to: { type: "string", enum: APPLIES_TO },
        is_enabled: { type: "boolean" },
        is_active: { type: "boolean" },
      },
    },
  },
};

export const IdParamSchema = {
  schema: {
    params: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", format: "uuid" } },
    },
  },
};

export const EnvQuerySchema = {
  schema: {
    querystring: {
      type: "object",
      required: ["env_id"],
      properties: { env_id: { type: "string", format: "uuid" } },
    },
  },
};

export const CheckSchema = {
  schema: {
    body: {
      type: "object",
      required: ["env_id"],
      properties: {
        env_id: { type: "string", format: "uuid" },
        email: { type: "string", pattern: EMAIL_PATTERN, nullable: true },
        ip: { type: "string", maxLength: 45, nullable: true },
        surface: { type: "string", enum: SURFACES },
      },
    },
  },
};

export { EMAIL_PATTERN };
