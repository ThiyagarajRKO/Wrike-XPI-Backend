import { WrikeCredentials } from "../../../../controllers";
import { encryptField } from "../../../../utils/crypto";
import { syncWrikeCredentialsFromDB } from "../../../../utils/wrikeCredentials";

export const UpdateEnvironment = (portalUser, id, body) => {
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

      // Regular portal users can only update environments mapped to them
      if (portalUser.role !== "admin") {
        const owned = await WrikeCredentials.GetByOwnerId(portalUser.id);
        if (!(owned || []).some((e) => e.id === id)) {
          return reject({
            statusCode: 403,
            message: "Forbidden: not your environment",
          });
        }
      }

      const {
        environment_name,
        client_id,
        client_secret,
        account_id,
        xpi_api_modules_datahub_id,
        xpi_api_services_datahub_id,
        xpi_entity_datahub_id,
        xpi_field_mapping_datahub_id,
        xpi_request_form_field_mapping_datahub_id,
        xpi_request_form_mapping_datahub_id,
        xpi_space_name_datahub_id,
        campaign_space_id,
        is_active,
        is_visible,
      } = body;

      const updateData = {};

      if (environment_name !== undefined) {
        if (!environment_name.trim()) {
          return reject({
            statusCode: 400,
            message: "Environment name cannot be empty",
          });
        }
        updateData.environment_name = environment_name.trim();
      }
      if (client_id !== undefined) {
        if (!client_id.trim())
          return reject({
            statusCode: 400,
            message: "Client ID cannot be empty",
          });
        updateData.client_id = encryptField(client_id.trim());
      }
      if (client_secret !== undefined) {
        if (!client_secret.trim())
          return reject({
            statusCode: 400,
            message: "Client Secret cannot be empty",
          });
        updateData.client_secret = encryptField(client_secret.trim());
      }
      if (account_id !== undefined)
        updateData.account_id = account_id ? account_id.trim() : null;
      if (xpi_api_modules_datahub_id !== undefined)
        updateData.xpi_api_modules_datahub_id =
          xpi_api_modules_datahub_id || null;
      if (xpi_api_services_datahub_id !== undefined)
        updateData.xpi_api_services_datahub_id =
          xpi_api_services_datahub_id || null;
      if (xpi_entity_datahub_id !== undefined)
        updateData.xpi_entity_datahub_id = xpi_entity_datahub_id || null;
      if (xpi_field_mapping_datahub_id !== undefined)
        updateData.xpi_field_mapping_datahub_id =
          xpi_field_mapping_datahub_id || null;
      if (xpi_request_form_field_mapping_datahub_id !== undefined)
        updateData.xpi_request_form_field_mapping_datahub_id =
          xpi_request_form_field_mapping_datahub_id || null;
      if (xpi_request_form_mapping_datahub_id !== undefined)
        updateData.xpi_request_form_mapping_datahub_id =
          xpi_request_form_mapping_datahub_id || null;
      if (xpi_space_name_datahub_id !== undefined)
        updateData.xpi_space_name_datahub_id =
          xpi_space_name_datahub_id || null;
      if (campaign_space_id !== undefined)
        updateData.campaign_space_id = campaign_space_id || null;
      if (is_active !== undefined) updateData.is_active = Boolean(is_active);
      if (is_visible !== undefined) updateData.is_visible = Boolean(is_visible);

      if (!Object.keys(updateData).length) {
        return reject({ statusCode: 400, message: "No fields to update" });
      }

      // Pass null as profile_id — updated_by/created_by FK references admin_users, not portal_users
      // The beforeUpdate hook still sets updated_at = new Date() properly
      await WrikeCredentials.Update(null, id, updateData);
      await syncWrikeCredentialsFromDB();

      return resolve({
        statusCode: 200,
        message: "Environment updated",
      });
    } catch (err) {
      console.log(err?.message || err);
      reject(err);
    }
  });
};
