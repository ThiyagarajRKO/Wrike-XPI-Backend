import { WrikeCredentials } from "../../../../controllers";
import { decryptField } from "../../../../utils/crypto";

export const GetMyEnvironments = (portalUser) => {
  return new Promise(async (resolve, reject) => {
    try {
      let environments;

      // Admin role sees ALL environments; regular users see only those mapped to them
      if (portalUser.role === "admin") {
        environments = await WrikeCredentials.GetAllForPortal();
      } else {
        environments = await WrikeCredentials.GetByOwnerId(portalUser.id);
      }

      const data = (environments || []).map((env) => ({
        id: env.id,
        environment_name: env.environment_name,
        client_id: env.client_id ? decryptField(env.client_id) : null,
        client_secret: env.client_secret
          ? decryptField(env.client_secret)
          : null,
        account_id: env.account_id || null,
        xpi_api_modules_datahub_id: env.xpi_api_modules_datahub_id || null,
        xpi_api_services_datahub_id: env.xpi_api_services_datahub_id || null,
        xpi_entity_datahub_id: env.xpi_entity_datahub_id || null,
        xpi_field_mapping_datahub_id: env.xpi_field_mapping_datahub_id || null,
        xpi_request_form_field_mapping_datahub_id:
          env.xpi_request_form_field_mapping_datahub_id || null,
        xpi_request_form_mapping_datahub_id:
          env.xpi_request_form_mapping_datahub_id || null,
        xpi_space_name_datahub_id: env.xpi_space_name_datahub_id || null,
        campaign_space_id: env.campaign_space_id || null,
        is_active: env.is_active,
        is_visible: env.is_visible,
        // Read by the portal's environment-access drawer (EnvironmentAccess
        // canWrite=false) to show the two gate switches in their real state
        // — omitting them would render both as unchecked regardless of the
        // actual value, which is misleading on a page whose whole point is
        // showing access scope accurately.
        allowlist_check_enabled: env.allowlist_check_enabled !== false,
        custom_field_check_enabled: !!env.custom_field_check_enabled,
        created_at: env.created_at,
        updated_at: env.updated_at,
      }));

      return resolve({
        statusCode: 200,
        message: "Environments retrieved",
        data,
      });
    } catch (err) {
      console.log(err?.message || err);
      reject(err);
    }
  });
};
