import models from "../../models";
import {
  MODULES,
  emptyMatrix,
  normaliseMatrix,
  roleForMatrix,
} from "../utils/permissionCatalog";

/**
 * Module-level RBAC for portal users — the storage side. Policy vocabulary
 * (which modules, which roles) lives in src/utils/permissionCatalog.js.
 */

const rowsToMatrix = (rows) => {
  const result = emptyMatrix();

  for (const row of rows) {
    if (!result[row.module]) continue;
    result[row.module] = {
      read: !!row.can_read,
      create: !!row.can_create,
      update: !!row.can_update,
      delete: !!row.can_delete,
    };
  }

  return result;
};

/**
 * A user's full matrix. Always returns every module — a user with no rows
 * yet gets an all-false matrix rather than an empty object, so callers never
 * have to distinguish "not configured" from "denied". Both mean denied.
 */
export const GetMatrix = async (userId) => {
  if (!userId) throw { statusCode: 400, message: "User id must not be empty!" };

  const rows = await models.PortalUserPermissions.findAll({
    where: { user_id: userId },
    raw: true,
  });

  const permissions = rowsToMatrix(rows);

  return {
    permissions,
    role: roleForMatrix(permissions),
    configured: rows.length > 0,
  };
};

/** Matrices for many users at once — one query, for the Permissions table. */
export const GetMatrixForUsers = async (userIds = []) => {
  if (!userIds.length) return {};

  const rows = await models.PortalUserPermissions.findAll({
    where: { user_id: userIds },
    raw: true,
  });

  const byUser = {};
  for (const row of rows) {
    (byUser[row.user_id] ||= []).push(row);
  }

  const result = {};
  for (const userId of userIds) {
    const permissions = rowsToMatrix(byUser[userId] || []);
    result[userId] = {
      permissions,
      role: roleForMatrix(permissions),
      configured: !!byUser[userId],
    };
  }

  return result;
};

/**
 * Replace a user's whole matrix in one transaction.
 *
 * Whole-matrix rather than per-cell: a permissions screen is edited as one
 * decision ("this person is a Contributor"), and a partial write would leave
 * the user in a state the admin never actually chose if one row failed.
 */
export const SetMatrix = async (profileId, userId, input) => {
  if (!userId) throw { statusCode: 400, message: "User id must not be empty!" };

  const user = await models.PortalUsers.findOne({ where: { id: userId } });
  if (!user) throw { statusCode: 404, message: "User not found." };

  const permissions = normaliseMatrix(input);

  await models.sequelize.transaction(async (transaction) => {
    for (const mod of MODULES) {
      const grant = permissions[mod.key];
      const payload = {
        can_read: !!grant.read,
        can_create: !!grant.create,
        can_update: !!grant.update,
        can_delete: !!grant.delete,
      };

      const existing = await models.PortalUserPermissions.findOne({
        where: { user_id: userId, module: mod.key },
        transaction,
      });

      if (existing) {
        await existing.update(payload, { transaction, profile_id: profileId });
      } else {
        await models.PortalUserPermissions.create(
          { user_id: userId, module: mod.key, ...payload },
          { transaction, profile_id: profileId },
        );
      }
    }
  });

  return { permissions, role: roleForMatrix(permissions) };
};

/**
 * Everything that answers "what can this person do?" in one payload — the
 * unified view the console's permission drawer renders:
 *
 *   1. who they are and their portal role
 *   2. their environment scope (the environments they own)
 *   3. their module matrix
 *
 * Assembled here rather than by three round trips from the browser, so the
 * drawer opens with one request and can never show a half-loaded answer.
 */
export const GetUserAccessSummary = async (userId) => {
  if (!userId) throw { statusCode: 400, message: "User id must not be empty!" };

  const user = await models.PortalUsers.findOne({
    attributes: [
      "id",
      "username",
      "full_name",
      "email",
      "role",
      "is_active",
      "last_login_at",
    ],
    where: { id: userId },
  });
  if (!user) throw { statusCode: 404, message: "User not found." };

  const [environments, matrix] = await Promise.all([
    models.WrikeCredentials.findAll({
      attributes: ["id", "environment_name", "is_active", "is_visible"],
      where: { owner_id: userId, is_active: true, deleted_at: null },
      order: [["environment_name", "ASC"]],
      raw: true,
    }),
    GetMatrix(userId),
  ]);

  return {
    user: user.get({ plain: true }),
    environment_scope: environments,
    permissions: matrix.permissions,
    role: matrix.role,
    configured: matrix.configured,
  };
};
