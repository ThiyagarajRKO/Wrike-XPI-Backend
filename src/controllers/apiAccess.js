import models from "../../models";

const { Op } = models.Sequelize;

/* ── Shared shaping ────────────────────────────────────────────────────── */

const RULE_ATTRS = [
  "id",
  "env_id",
  "rule_type",
  "value",
  "label",
  "is_enabled",
  "can_read",
  "can_create",
  "can_update",
  "can_delete",
  "is_active",
  "created_at",
  "updated_at",
];

const PERMISSION_ATTRS = [
  "id",
  "env_id",
  "email",
  "display_name",
  "can_read",
  "can_create",
  "can_update",
  "can_delete",
  "is_active",
  "created_at",
  "updated_at",
];

const clean = (value) => String(value ?? "").trim().toLowerCase();

const requireEnv = (envId) => {
  if (!envId) {
    throw { statusCode: 400, message: "Environment must not be empty!" };
  }
};

/* ── Allow-list rules (gate 1) ─────────────────────────────────────────── */

export const GetRulesByEnv = async (envId) => {
  requireEnv(envId);

  const rules = await models.ApiAccessRules.findAll({
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

  const rule = await models.ApiAccessRules.findOne({
    attributes: RULE_ATTRS,
    where: { id, is_active: true },
  });

  return rule ? rule.get({ plain: true }) : null;
};

export const CreateRule = async (profileId, data) => {
  requireEnv(data?.env_id);

  const value = clean(data?.value);
  if (!value) throw { statusCode: 400, message: "Value must not be empty!" };

  const existing = await models.ApiAccessRules.findOne({
    where: { env_id: data.env_id, rule_type: data.rule_type, value },
  });
  if (existing) {
    throw {
      statusCode: 409,
      message: `"${value}" is already on the allow list for this environment.`,
    };
  }

  const rule = await models.ApiAccessRules.create(
    { ...data, value },
    { profile_id: profileId },
  );

  return rule.get({ plain: true });
};

/**
 * Add many rules in one transaction — the paste-a-list path in the console.
 * Entries already present are reported back rather than failing the batch, so
 * pasting an overlapping list is a safe, repeatable operation.
 */
export const BulkCreateRules = async (profileId, envId, entries = []) => {
  requireEnv(envId);

  if (!Array.isArray(entries) || entries.length === 0) {
    throw { statusCode: 400, message: "No entries provided." };
  }

  const existing = await models.ApiAccessRules.findAll({
    attributes: ["rule_type", "value"],
    where: { env_id: envId },
  });
  const seen = new Set(existing.map((r) => `${r.rule_type}:${r.value}`));

  const toCreate = [];
  const skipped = [];

  for (const entry of entries) {
    const value = clean(entry?.value);
    const ruleType = entry?.rule_type === "domain" ? "domain" : "email";
    const key = `${ruleType}:${value}`;

    if (!value || seen.has(key)) {
      if (value) skipped.push(value);
      continue;
    }

    seen.add(key);
    toCreate.push({
      env_id: envId,
      rule_type: ruleType,
      value,
      label: entry?.label || null,
      is_enabled: entry?.is_enabled !== false,
      can_read: entry?.can_read !== false,
      can_create: !!entry?.can_create,
      can_update: !!entry?.can_update,
      can_delete: !!entry?.can_delete,
    });
  }

  if (toCreate.length === 0) return { created: 0, skipped };

  await models.sequelize.transaction(async (transaction) => {
    await models.ApiAccessRules.bulkCreate(toCreate, {
      transaction,
      individualHooks: true,
      profile_id: profileId,
    });
  });

  return { created: toCreate.length, skipped };
};

export const UpdateRule = async (profileId, id, data) => {
  if (!id) throw { statusCode: 400, message: "Rule id must not be empty!" };

  const rule = await models.ApiAccessRules.findOne({ where: { id } });
  if (!rule) throw { statusCode: 404, message: "Allow-list rule not found." };

  await rule.update(data, { profile_id: profileId });

  return rule.get({ plain: true });
};

export const DeleteRule = async (profileId, id) => {
  if (!id) throw { statusCode: 400, message: "Rule id must not be empty!" };

  const rule = await models.ApiAccessRules.findOne({ where: { id } });
  if (!rule) throw { statusCode: 404, message: "Allow-list rule not found." };

  const envId = rule.env_id;
  await rule.destroy({ profile_id: profileId });

  return { env_id: envId };
};

/* ── Per-user permissions (gate 3) ─────────────────────────────────────── */

export const GetPermissionsByEnv = async (envId) => {
  requireEnv(envId);

  const permissions = await models.ApiUserPermissions.findAll({
    attributes: PERMISSION_ATTRS,
    where: { env_id: envId, is_active: true },
    order: [["email", "ASC"]],
  });

  return permissions.map((p) => p.get({ plain: true }));
};

export const GetPermissionByEmail = async (envId, email) => {
  requireEnv(envId);

  const permission = await models.ApiUserPermissions.findOne({
    attributes: PERMISSION_ATTRS,
    where: { env_id: envId, email: clean(email), is_active: true },
  });

  return permission ? permission.get({ plain: true }) : null;
};

/**
 * Create or replace one user's grant. Upsert rather than create because the
 * "grant access" action is idempotent from the admin's point of view —
 * granting someone who already has a row edits that row.
 */
export const UpsertPermission = async (profileId, data) => {
  requireEnv(data?.env_id);

  const email = clean(data?.email);
  if (!email) throw { statusCode: 400, message: "Email must not be empty!" };

  const payload = {
    display_name: data?.display_name || null,
    can_read: data?.can_read !== false,
    can_create: !!data?.can_create,
    can_update: !!data?.can_update,
    can_delete: !!data?.can_delete,
    is_active: data?.is_active !== false,
  };

  const existing = await models.ApiUserPermissions.findOne({
    where: { env_id: data.env_id, email },
  });

  if (existing) {
    await existing.update(payload, { profile_id: profileId });
    return existing.get({ plain: true });
  }

  const created = await models.ApiUserPermissions.create(
    { env_id: data.env_id, email, ...payload },
    { profile_id: profileId },
  );

  return created.get({ plain: true });
};

export const UpdatePermission = async (profileId, id, data) => {
  if (!id) {
    throw { statusCode: 400, message: "Permission id must not be empty!" };
  }

  const permission = await models.ApiUserPermissions.findOne({ where: { id } });
  if (!permission) throw { statusCode: 404, message: "Permission not found." };

  await permission.update(data, { profile_id: profileId });

  return permission.get({ plain: true });
};

export const DeletePermission = async (profileId, id) => {
  if (!id) {
    throw { statusCode: 400, message: "Permission id must not be empty!" };
  }

  const permission = await models.ApiUserPermissions.findOne({ where: { id } });
  if (!permission) throw { statusCode: 404, message: "Permission not found." };

  const envId = permission.env_id;
  await permission.destroy({ profile_id: profileId });

  return { env_id: envId };
};

/* ── Console summary ───────────────────────────────────────────────────── */

/**
 * One row per environment with its rule/grant counts — feeds the environment
 * picker so an admin can see which environments are actually governed before
 * clicking into one.
 */
export const GetSummary = async () => {
  const enabledCount = models.sequelize.fn(
    "COUNT",
    models.sequelize.literal('CASE WHEN is_enabled = true THEN 1 END'),
  );

  const [rules, permissions] = await Promise.all([
    models.ApiAccessRules.findAll({
      attributes: [
        "env_id",
        [models.sequelize.fn("COUNT", models.sequelize.col("id")), "total"],
        [enabledCount, "enabled"],
      ],
      where: { is_active: true },
      group: ["env_id"],
      raw: true,
    }),
    models.ApiUserPermissions.findAll({
      attributes: [
        "env_id",
        [models.sequelize.fn("COUNT", models.sequelize.col("id")), "total"],
      ],
      where: { is_active: true },
      group: ["env_id"],
      raw: true,
    }),
  ]);

  const byEnv = {};

  for (const row of rules) {
    byEnv[row.env_id] = {
      env_id: row.env_id,
      rules_total: Number(row.total) || 0,
      rules_enabled: Number(row.enabled) || 0,
      users_total: 0,
    };
  }

  for (const row of permissions) {
    byEnv[row.env_id] = {
      env_id: row.env_id,
      rules_total: byEnv[row.env_id]?.rules_total || 0,
      rules_enabled: byEnv[row.env_id]?.rules_enabled || 0,
      users_total: Number(row.total) || 0,
    };
  }

  return Object.values(byEnv);
};

/** Emails already granted in *other* environments — powers "copy from" reuse. */
export const GetKnownEmails = async (excludeEnvId = null) => {
  const where = { is_active: true };
  if (excludeEnvId) where.env_id = { [Op.ne]: excludeEnvId };

  const rows = await models.ApiUserPermissions.findAll({
    attributes: [
      [models.sequelize.fn("DISTINCT", models.sequelize.col("email")), "email"],
    ],
    where,
    raw: true,
  });

  return rows.map((r) => r.email).filter(Boolean);
};
