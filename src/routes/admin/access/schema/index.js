const EMAIL_PATTERN = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";
const DOMAIN_PATTERN = "^@?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$";

const permissionProps = {
  can_read: { type: "boolean" },
  can_create: { type: "boolean" },
  can_update: { type: "boolean" },
  can_delete: { type: "boolean" },
};

export const CreateRuleSchema = {
  schema: {
    body: {
      type: "object",
      required: ["env_id", "rule_type", "value"],
      properties: {
        env_id: { type: "string", format: "uuid" },
        rule_type: { type: "string", enum: ["email", "domain"] },
        // Deliberately not pattern-validated here: an email rule and a domain
        // rule need different patterns, and Fastify cannot express that
        // dependency cleanly. The handler validates against rule_type.
        value: { type: "string", minLength: 3, maxLength: 320 },
        label: { type: "string", maxLength: 255, nullable: true },
        is_enabled: { type: "boolean" },
        ...permissionProps,
      },
    },
  },
};

export const BulkCreateRulesSchema = {
  schema: {
    body: {
      type: "object",
      required: ["env_id", "entries"],
      properties: {
        env_id: { type: "string", format: "uuid" },
        entries: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          items: {
            type: "object",
            required: ["value"],
            properties: {
              value: { type: "string", minLength: 3, maxLength: 320 },
              rule_type: { type: "string", enum: ["email", "domain"] },
              label: { type: "string", maxLength: 255, nullable: true },
              is_enabled: { type: "boolean" },
              ...permissionProps,
            },
          },
        },
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
        value: { type: "string", minLength: 3, maxLength: 320 },
        label: { type: "string", maxLength: 255, nullable: true },
        is_enabled: { type: "boolean" },
        is_active: { type: "boolean" },
        ...permissionProps,
      },
    },
  },
};

export const UpsertPermissionSchema = {
  schema: {
    body: {
      type: "object",
      required: ["env_id", "email"],
      properties: {
        env_id: { type: "string", format: "uuid" },
        email: { type: "string", pattern: EMAIL_PATTERN, maxLength: 320 },
        display_name: { type: "string", maxLength: 255, nullable: true },
        is_active: { type: "boolean" },
        ...permissionProps,
      },
    },
  },
};

export const UpdatePermissionSchema = {
  schema: {
    params: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", format: "uuid" } },
    },
    body: {
      type: "object",
      properties: {
        display_name: { type: "string", maxLength: 255, nullable: true },
        is_active: { type: "boolean" },
        ...permissionProps,
      },
    },
  },
};

export const SimulateSchema = {
  schema: {
    body: {
      type: "object",
      required: ["env_id", "email"],
      properties: {
        env_id: { type: "string", format: "uuid" },
        email: { type: "string", pattern: EMAIL_PATTERN, maxLength: 320 },
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

export { EMAIL_PATTERN, DOMAIN_PATTERN };
