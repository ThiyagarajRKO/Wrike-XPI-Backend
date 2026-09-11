import { WrikeCredentials, PortalAuth } from "../../../../controllers";
import { encryptField } from "../../../../utils/crypto";
import { syncWrikeCredentialsFromDB } from "../../../../utils/wrikeCredentials";

export const CreateEnvironment = (portalUser, body) => {
  return new Promise(async (resolve, reject) => {
    try {
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

      if (!environment_name || !environment_name.trim())
        return reject({
          statusCode: 400,
          message: "Environment name is required",
        });
      if (!client_id || !client_id.trim())
        return reject({ statusCode: 400, message: "Client ID is required" });
      if (!client_secret || !client_secret.trim())
        return reject({
          statusCode: 400,
          message: "Client Secret is required",
        });
      if (!xpi_api_modules_datahub_id || !xpi_api_modules_datahub_id.trim())
        return reject({
          statusCode: 400,
          message: "XPI API Modules Datahub ID is required",
        });
      if (!xpi_api_services_datahub_id || !xpi_api_services_datahub_id.trim())
        return reject({
          statusCode: 400,
          message: "XPI API Services Datahub ID is required",
        });
      if (!xpi_entity_datahub_id || !xpi_entity_datahub_id.trim())
        return reject({
          statusCode: 400,
          message: "XPI Entity Datahub ID is required",
        });
      if (!xpi_field_mapping_datahub_id || !xpi_field_mapping_datahub_id.trim())
        return reject({
          statusCode: 400,
          message: "XPI Field Mapping Datahub ID is required",
        });
      if (
        !xpi_request_form_field_mapping_datahub_id ||
        !xpi_request_form_field_mapping_datahub_id.trim()
      )
        return reject({
          statusCode: 400,
          message: "XPI Request Form Field Mapping Datahub ID is required",
        });
      if (
        !xpi_request_form_mapping_datahub_id ||
        !xpi_request_form_mapping_datahub_id.trim()
      )
        return reject({
          statusCode: 400,
          message: "XPI Request Form Mapping Datahub ID is required",
        });
      if (!xpi_space_name_datahub_id || !xpi_space_name_datahub_id.trim())
        return reject({
          statusCode: 400,
          message: "XPI Space Name Datahub ID is required",
        });
      if (!campaign_space_id || !campaign_space_id.trim())
        return reject({
          statusCode: 400,
          message: "Campaign Space ID is required",
        });

      const data = {
        environment_name: environment_name.trim(),
        client_id: encryptField(client_id.trim()),
        client_secret: encryptField(client_secret.trim()),
        account_id: account_id ? account_id.trim() : null,
        xpi_api_modules_datahub_id: xpi_api_modules_datahub_id.trim(),
        xpi_api_services_datahub_id: xpi_api_services_datahub_id.trim(),
        xpi_entity_datahub_id: xpi_entity_datahub_id.trim(),
        xpi_field_mapping_datahub_id: xpi_field_mapping_datahub_id.trim(),
        xpi_request_form_field_mapping_datahub_id:
          xpi_request_form_field_mapping_datahub_id.trim(),
        xpi_request_form_mapping_datahub_id:
          xpi_request_form_mapping_datahub_id.trim(),
        xpi_space_name_datahub_id: xpi_space_name_datahub_id.trim(),
        campaign_space_id: campaign_space_id.trim(),
        is_active: is_active !== undefined ? Boolean(is_active) : true,
        is_visible: is_visible !== undefined ? Boolean(is_visible) : true,
      };

      // Pass null as profile_id — updated_by FK references admin_users, not portal_users
      const env = await WrikeCredentials.Insert(null, data);

      // Admin portal users create shared envs (no mapping); regular users
      // are mapped to the one they created.
      if (portalUser.role !== "admin") {
        await PortalAuth.AssignEnvironment(null, portalUser.id, env.id);
      }

      await syncWrikeCredentialsFromDB();

      return resolve({
        statusCode: 201,
        message: "Environment created",
        data: {
          id: env.id,
          environment_name: env.environment_name,
          account_id: env.account_id || null,
          is_active: env.is_active,
          is_visible: env.is_visible,
        },
      });
    } catch (err) {
      console.log(err?.message || err);
      reject(err);
    }
  });
};
