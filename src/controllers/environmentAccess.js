import models from "../../models";
import ipaddr from "ipaddr.js";
import { invalidateEnvironment } from "../utils/environmentAccessCache";

/**
 * Environment-level API access scope — the storage side. Policy evaluation
 * (does a given caller match) lives in src/utils/environmentAccess.js.
 *
 * Every write here (an email, domain or IP entry added, edited, enabled,
 * disabled or removed) drops that environment's cached access scope before
 * returning, so the change is enforced on the very next API or MCP call.
 * Invalidating here rather than in the route handlers means a new write path
 * cannot forget to do it.
 */

const RULE_ATTRS = [
  "id",
  "env_id",
  "rule_type",
  "value",
  "label",
  "applies_to",
  "is_enabled",
  "is_active",
  "created_at",
  "updated_at",
];

/** Surfaces an allow-list entry can govern. */
export const APPLIES_TO = ["api", "mcp", "both"];

const requireEnv = (envId) => {
  if (!envId) throw { statusCode: 400, message: "Environment must not be empty!" };
};

/**
 * Normalise and validate the surface an entry applies to. Undefined means
 * "unchanged" on an update and falls back to the column default on a create;
 * anything else must be one of the three known surfaces. Deliberately strict:
 * silently coercing an unrecognised value to "both" would widen access.
 */
const normaliseAppliesTo = (raw) => {
  if (raw === undefined || raw === null || raw === "") return undefined;

  const value = String(raw).trim().toLowerCase();
  if (!APPLIES_TO.includes(value)) {
    throw {
      statusCode: 400,
      message: `"${raw}" is not a valid surface. Use one of: ${APPLIES_TO.join(", ")}.`,
    };
  }
  return value;
};

/** Reject a value that doesn't parse as what its rule_type claims. */
export const validateRuleValue = (ruleType, rawValue) => {
  const value = String(rawValue || "").trim();

  if (!value) throw { statusCode: 400, message: "Value must not be empty!" };

  if (ruleType === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw { statusCode: 400, message: `"${value}" is not a valid email address.` };
    }
    return;
  }

  if (ruleType === "domain") {
    const bare = value.replace(/^@+/, "");
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(bare)) {
      throw { statusCode: 400, message: `"${value}" is not a valid domain.` };
    }
    return;
  }

  if (ruleType === "ip") {
    try {
      if (value.includes("/")) {
        ipaddr.parseCIDR(value);
      } else {
        ipaddr.parse(value);
      }
    } catch {
      throw {
        statusCode: 400,
        message: `"${value}" is not a valid IP address or CIDR range (e.g. 203.0.113.4 or 203.0.113.0/24).`,
      };
    }
    return;
  }

  throw { statusCode: 400, message: `Unknown rule type "${ruleType}".` };
};

export const GetRulesByEnv = async (envId) => {
  requireEnv(envId);

  const rules = await models.EnvironmentAccessRules.findAll({
    attributes: RULE_ATTRS,
    where: { env_id: envId, is_active: true },
    order: [
      ["rule_type", "ASC"],
      ["value", "ASC"],
    ],
  });

  return rules.map((r) => r.get({ plain: true }));
};

export const GetRuleById = async (id) => {
  if (!id) throw { statusCode: 400, message: "Rule id must not be empty!" };

  const rule = await models.EnvironmentAccessRules.findOne({
    attributes: RULE_ATTRS,
    where: { id, is_active: true },
  });

  return rule ? rule.get({ plain: true }) : null;
};

export const CreateRule = async (profileId, data) => {
  requireEnv(data?.env_id);
  validateRuleValue(data?.rule_type, data?.value);

  const value =
    data.rule_type === "domain"
      ? String(data.value).trim().replace(/^@+/, "").toLowerCase()
      : String(data.value).trim().toLowerCase();

  const existing = await models.EnvironmentAccessRules.findOne({
    where: { env_id: data.env_id, rule_type: data.rule_type, value },
  });
  if (existing) {
    throw {
      statusCode: 409,
      message: `"${value}" is already on the allow list for this environment.`,
    };
  }

  const rule = await models.EnvironmentAccessRules.create(
    {
      env_id: data.env_id,
      rule_type: data.rule_type,
      value,
      label: data.label || null,
      applies_to: normaliseAppliesTo(data.applies_to) || "both",
      is_enabled: data.is_enabled !== false,
    },
    { profile_id: profileId },
  );

  await invalidateEnvironment(rule.env_id);

  return rule.get({ plain: true });
};

export const UpdateRule = async (profileId, id, data) => {
  if (!id) throw { statusCode: 400, message: "Rule id must not be empty!" };

  const rule = await models.EnvironmentAccessRules.findOne({ where: { id } });
  if (!rule) throw { statusCode: 404, message: "Allow-list rule not found." };

  if (data?.value !== undefined) {
    validateRuleValue(rule.rule_type, data.value);
  }

  const appliesTo = normaliseAppliesTo(data?.applies_to);

  // Captured before the update: if a future caller is ever allowed to move a
  // rule between environments, BOTH sides need their cache dropped.
  const previousEnvId = rule.env_id;

  await rule.update(
    appliesTo === undefined ? data : { ...data, applies_to: appliesTo },
    { profile_id: profileId },
  );

  await invalidateEnvironment(previousEnvId);
  if (rule.env_id !== previousEnvId) await invalidateEnvironment(rule.env_id);

  return rule.get({ plain: true });
};

export const DeleteRule = async (profileId, id) => {
  if (!id) throw { statusCode: 400, message: "Rule id must not be empty!" };

  const rule = await models.EnvironmentAccessRules.findOne({ where: { id } });
  if (!rule) throw { statusCode: 404, message: "Allow-list rule not found." };

  const envId = rule.env_id;
  await rule.destroy({ profile_id: profileId });

  await invalidateEnvironment(envId);

  return { env_id: envId };
};

/** One row per environment with its rule counts — feeds the row badge. */
export const GetSummary = async () => {
  const rows = await models.EnvironmentAccessRules.findAll({
    attributes: [
      "env_id",
      [models.sequelize.fn("COUNT", models.sequelize.col("id")), "total"],
      [
        models.sequelize.fn(
          "COUNT",
          models.sequelize.literal("CASE WHEN is_enabled = true THEN 1 END"),
        ),
        "enabled",
      ],
    ],
    where: { is_active: true },
    group: ["env_id"],
    raw: true,
  });

  const byEnv = {};
  for (const row of rows) {
    byEnv[row.env_id] = {
      env_id: row.env_id,
      rules_total: Number(row.total) || 0,
      rules_enabled: Number(row.enabled) || 0,
    };
  }
  return byEnv;
};
