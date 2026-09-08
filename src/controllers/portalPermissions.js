import models from "../../models";
import { MODULES, emptyMatrix, normaliseMatrix } from "../utils/portalPermissionCatalog";

/**
 * Module-level permissions for portal users — the storage side. Vocabulary
 * (which modules, which actions) lives in src/utils/portalPermissionCatalog.js.
 */

const rowsToMatrix = (rows) => {
  const result = emptyMatrix();

  for (const row of rows) {
    if (!result[row.module]) continue; // a module later removed from the catalog
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
 * yet gets an all-false matrix, not an empty object, so the caller never has
 * to tell "not configured" apart from "denied". Both mean denied.
 */
export const GetMatrix = async (userId) => {
  if (!userId) throw { statusCode: 400, message: "User id must not be empty!" };

  const rows = await models.PortalUserPermissions.findAll({
    where: { user_id: userId },
    raw: true,
  });

  return rowsToMatrix(rows);
};

/**
 * Replace a user's whole matrix in one transaction.
 *
 * Whole-matrix rather than per-cell: this is edited as one decision ("grant
 * this person X, Y, Z"), and a partial write would leave the user with a
 * combination nobody actually chose if one row failed.
 */
export const SetMatrix = async (profileId, userId, input) => {
  if (!userId) throw { statusCode: 400, message: "User id must not be empty!" };

  const user = await models.PortalUsers.findOne({ where: { id: userId } });
  if (!user) throw { statusCode: 404, message: "User not found." };

  const matrix = normaliseMatrix(input);

  await models.sequelize.transaction(async (transaction) => {
    for (const mod of MODULES) {
      const grant = matrix[mod.key];
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

  return matrix;
};

/** Matrices for many users at once — one query, for a future table view. */
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
    result[userId] = rowsToMatrix(byUser[userId] || []);
  }

  return result;
};
