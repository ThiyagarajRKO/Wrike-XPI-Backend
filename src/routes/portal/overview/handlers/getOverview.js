import { WrikeCredentials } from "../../../../controllers";

/**
 * The portal dashboard summary: how many environments this caller has, and
 * how many of them are active / visible.
 *
 * Counts only — no names, no ids, no credentials. That is what keeps
 * "Overview" a coherent module of its own (src/utils/portalPermissionCatalog.js
 * declares it read-only) rather than a second door onto the Environments
 * module's records: a user granted overview:read without environments:read
 * can see that they have three environments, not which three.
 *
 * Scoping matches GetMyEnvironments: admin-role portal users count every
 * environment, everyone else counts only their own.
 */
export const GetMyOverview = (portalUser) => {
  return new Promise(async (resolve, reject) => {
    try {
      const environments =
        portalUser.role === "admin"
          ? await WrikeCredentials.GetAllForPortal()
          : await WrikeCredentials.GetByOwnerId(portalUser.id);

      const rows = environments || [];
      const active = rows.filter((env) => !!env?.is_active).length;
      const visible = rows.filter((env) => !!env?.is_visible).length;

      return resolve({
        statusCode: 200,
        message: "Overview retrieved",
        data: {
          total: rows.length,
          active,
          inactive: rows.length - active,
          visible,
        },
      });
    } catch (err) {
      console.log(err?.message || err);
      reject(err);
    }
  });
};
