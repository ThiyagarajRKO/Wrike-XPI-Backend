import { syncWrikeCredentialsFromDB } from "../../../../utils/wrikeCredentials";
import { WrikeCredentials } from "../../../../controllers";
import { invalidateEnvironment } from "../../../../utils/environmentAccess";

/**
 * Flip is_active, is_visible, and/or the two API-access security switches on
 * an environment — the switches an admin clicks directly from the
 * Environments list or the API Access Scope drawer. Deliberately separate
 * from the full Update handler (schema/update.js), which requires the whole
 * credential form (client_id, every Datahub id, ...) to be resent; a switch
 * flip has none of that and shouldn't need it.
 */
export const Toggle = (profile_id, { id }, body) => {
  return new Promise(async (resolve, reject) => {
    try {
      const {
        is_active,
        is_visible,
        allowlist_check_enabled,
        custom_field_check_enabled,
      } = body || {};

      const updates = {};
      if (is_active !== undefined) updates.is_active = is_active;
      if (is_visible !== undefined) updates.is_visible = is_visible;
      if (allowlist_check_enabled !== undefined) {
        updates.allowlist_check_enabled = allowlist_check_enabled;
      }
      if (custom_field_check_enabled !== undefined) {
        updates.custom_field_check_enabled = custom_field_check_enabled;
      }

      if (Object.keys(updates).length === 0) {
        return reject({
          statusCode: 400,
          message: "Provide at least one switch to update.",
        });
      }

      const credential = await WrikeCredentials.GetById(id);
      if (!credential) {
        return reject({ statusCode: 404, message: "Credential not found" });
      }

      const updated = await WrikeCredentials.Update(profile_id, id, updates);

      // Environments feed the in-memory credential cache (getCachedWrikeCredentials
      // / getCachedVisibleWrikeCredentials) that Wrike-facing requests read from —
      // keep it in sync the same way the full Update handler does.
      await syncWrikeCredentialsFromDB();

      // The allow-list gate caches this environment's switch state
      // (src/utils/environmentAccess.js) — drop it so a flip takes effect on
      // the very next API/MCP call instead of waiting out the cache TTL.
      if (allowlist_check_enabled !== undefined) {
        await invalidateEnvironment(id);
      }

      if (updated[0] <= 0) {
        return reject({
          statusCode: 400,
          message: "Update failed! Please try again.",
        });
      }

      return resolve({
        statusCode: 200,
        message: "Environment updated.",
        data: { id, ...updates },
      });
    } catch (err) {
      console.log(err?.message || err);
      reject(err);
    }
  });
};
