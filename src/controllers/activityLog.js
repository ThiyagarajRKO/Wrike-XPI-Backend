import models from "../../models";

const { Op } = models.Sequelize;

/**
 * API/MCP call activity log — storage only. Written on essentially every
 * authenticated request, so every query here stays index-backed and cheap;
 * policy (what gets logged, retention) lives in src/utils/activityLog.js.
 */

const ROW_ATTRS = [
  "id",
  "env_id",
  "environment_name",
  "surface",
  "actor_email",
  "action",
  "resource",
  "method",
  "allowed",
  "code",
  "status_code",
  "ip",
  "created_at",
];

export const Record = async (entry) => {
  return models.ApiActivityLogs.create({
    env_id: entry.envId || null,
    environment_name: entry.environmentName || null,
    surface: entry.surface,
    actor_email: entry.actorEmail || null,
    action: entry.action || null,
    resource: entry.resource,
    method: entry.method || null,
    allowed: !!entry.allowed,
    code: entry.code || null,
    status_code: entry.statusCode ?? null,
    ip: entry.ip || null,
  });
};

/**
 * Paginated, filtered listing for the admin console. `limit` is capped hard
 * (this table can get large fast) rather than trusting the caller.
 */
export const List = async ({
  envId,
  actorEmail,
  surface,
  allowed,
  from,
  to,
  limit = 50,
  offset = 0,
} = {}) => {
  const where = {};
  if (envId) where.env_id = envId;
  if (actorEmail) where.actor_email = { [Op.iLike]: `%${actorEmail.trim().toLowerCase()}%` };
  if (surface) where.surface = surface;
  if (allowed !== undefined && allowed !== null) where.allowed = allowed;
  if (from || to) {
    where.created_at = {};
    if (from) where.created_at[Op.gte] = new Date(from);
    if (to) where.created_at[Op.lte] = new Date(to);
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const { rows, count } = await models.ApiActivityLogs.findAndCountAll({
    attributes: ROW_ATTRS,
    where,
    order: [["created_at", "DESC"]],
    limit: safeLimit,
    offset: safeOffset,
  });

  return {
    rows: rows.map((r) => r.get({ plain: true })),
    total: count,
    limit: safeLimit,
    offset: safeOffset,
  };
};

/** Quick counts for the console's summary strip. */
export const Summary = async ({ envId, since } = {}) => {
  const where = {};
  if (envId) where.env_id = envId;
  if (since) where.created_at = { [Op.gte]: new Date(since) };

  const [total, denied] = await Promise.all([
    models.ApiActivityLogs.count({ where }),
    models.ApiActivityLogs.count({ where: { ...where, allowed: false } }),
  ]);

  return { total, denied, allowed: total - denied };
};

/** Hard-deletes rows older than `cutoff`. Used by the retention sweep. */
export const DeleteOlderThan = async (cutoff) => {
  return models.ApiActivityLogs.destroy({
    where: { created_at: { [Op.lt]: cutoff } },
  });
};
