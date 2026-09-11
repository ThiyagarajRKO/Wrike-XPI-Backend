import { WrikeCredentials } from "../../../../controllers";
import { syncWrikeCredentialsFromDB } from "../../../../utils/wrikeCredentials";

export const DeleteEnvironment = (portalUser, id) => {
  return new Promise(async (resolve, reject) => {
    try {
      if (!id) {
        return reject({
          statusCode: 400,
          message: "Environment id is required",
        });
      }

      const env = await WrikeCredentials.GetById(id);
      if (!env) {
        return reject({ statusCode: 404, message: "Environment not found" });
      }

      // Regular portal users can only delete environments mapped to them
      if (portalUser.role !== "admin") {
        const owned = await WrikeCredentials.GetByOwnerId(portalUser.id);
        if (!(owned || []).some((e) => e.id === id)) {
          return reject({
            statusCode: 403,
            message: "Forbidden: not your environment",
          });
        }
      }

      // Pass null as profile_id — updated_by FK references admin_users, not portal_users
      // The afterDestroy hook sets is_active = false and updated_at is set by beforeUpdate
      await WrikeCredentials.DeleteById(null, id);
      await syncWrikeCredentialsFromDB();

      return resolve({
        statusCode: 200,
        message: "Environment deleted",
      });
    } catch (err) {
      console.log(err?.message || err);
      reject(err);
    }
  });
};
