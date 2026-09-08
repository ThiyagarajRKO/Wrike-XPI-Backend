import { decryptField } from "../../../../utils/crypto";
import { WrikeCredentials } from "../../../../controllers";

export const GetAll = () => {
  return new Promise(async (resolve, reject) => {
    try {
      const credentials = await WrikeCredentials.GetAllWithDeleted();

      const data = credentials.map((cred) => ({
        id: cred.id,
        environment_name: cred.environment_name,
        client_id: cred.client_id ? decryptField(cred.client_id) : null,
        client_secret: cred.client_secret || null,
        account_id: cred.account_id || null,
        xpi_api_modules_datahub_id: cred.xpi_api_modules_datahub_id || null,
        xpi_api_services_datahub_id: cred.xpi_api_services_datahub_id || null,
        xpi_entity_datahub_id: cred.xpi_entity_datahub_id || null,
        xpi_field_mapping_datahub_id: cred.xpi_field_mapping_datahub_id || null,
        xpi_request_form_field_mapping_datahub_id:
          cred.xpi_request_form_field_mapping_datahub_id || null,
        xpi_request_form_mapping_datahub_id:
          cred.xpi_request_form_mapping_datahub_id || null,
        xpi_space_name_datahub_id: cred.xpi_space_name_datahub_id || null,
        campaign_space_id: cred.campaign_space_id || null,
        owner_id: cred.owner_id || null,
        is_active: cred.is_active,
        is_visible: cred.is_visible,
        allowlist_check_enabled: cred.allowlist_check_enabled,
        custom_field_check_enabled: cred.custom_field_check_enabled,
        created_at: cred.created_at,
        updated_at: cred.updated_at,
      }));

      return resolve({
        statusCode: 200,
        message: "Credentials retrieved",
        data,
      });
    } catch (err) {
      console.log(err?.message || err);
      reject(err);
    }
  });
};
