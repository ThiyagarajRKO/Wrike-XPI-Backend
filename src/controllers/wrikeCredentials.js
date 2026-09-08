import models from "../../models";

// Create a new credential record
export const Insert = async (profile_id, data, options = {}) => {
  try {
    const credential = await models.WrikeCredentials.create(data, {
      profile_id,
      ...options,
    });
    return credential;
  } catch (err) {
    throw err;
  }
};

// Update credentials by UUID primary key
export const Update = async (profile_id, id, data, options = {}) => {
  try {
    if (!id) {
      throw {
        statusCode: 420,
        message: "Id must not be empty!",
      };
    }

    const wrikeCredentialsUpdated = await models.WrikeCredentials.update(data, {
      where: { id },
      individualHooks: true,
      profile_id,
      ...options,
    });

    return wrikeCredentialsUpdated;
  } catch (err) {
    throw err;
  }
};

// Get credentials by environment name
export const GetByType = async (environmentName) => {
  try {
    if (!environmentName || typeof environmentName !== "string") {
      throw {
        statusCode: 400,
        message: "Invalid environment name",
      };
    }

    const credential = await models.WrikeCredentials.findOne({
      where: {
        environment_name: environmentName,
        is_active: true,
        deleted_at: null,
      },
    });

    return credential;
  } catch (err) {
    throw err;
  }
};

// Get all active credentials
export const GetAll = async () => {
  try {
    const credentials = await models.WrikeCredentials.findAll({
      where: {
        is_active: true,
        deleted_at: null,
      },
      order: [["created_at", "DESC"]],
    });

    return credentials;
  } catch (err) {
    throw err;
  }
};

// Get admin-level environments (owner_id is null — not assigned to any portal user)
export const GetAdminEnvironments = async () => {
  try {
    const credentials = await models.WrikeCredentials.findAll({
      where: {
        owner_id: null,
        is_active: true,
        deleted_at: null,
      },
      order: [["created_at", "DESC"]],
    });
    return credentials;
  } catch (err) {
    throw err;
  }
};

// Get all active and visible credentials (for user-facing dropdowns)
export const GetAllVisible = async () => {
  try {
    const credentials = await models.WrikeCredentials.findAll({
      where: {
        is_active: true,
        is_visible: true,
        deleted_at: null,
      },
      order: [["created_at", "DESC"]],
    });

    return credentials;
  } catch (err) {
    throw err;
  }
};

// Get credentials by UUID primary key
export const GetById = async (id) => {
  try {
    if (!id) {
      throw {
        statusCode: 420,
        message: "Id must not be empty!",
      };
    }

    const credential = await models.WrikeCredentials.findOne({
      where: { id, deleted_at: null },
    });

    return credential;
  } catch (err) {
    throw err;
  }
};

// The two API-access security switches only — used by the request-path
// gate (src/utils/environmentAccess.js), which must never touch a model
// directly and reads nothing else about the environment.
export const GetSwitches = async (id) => {
  try {
    if (!id) return null;

    const credential = await models.WrikeCredentials.findOne({
      attributes: ["allowlist_check_enabled", "custom_field_check_enabled"],
      where: { id },
    });

    if (!credential) return null;

    return {
      allowlistCheckEnabled: credential.allowlist_check_enabled !== false,
      customFieldCheckEnabled: !!credential.custom_field_check_enabled,
    };
  } catch (err) {
    throw err;
  }
};

// Get all credentials regardless of status (for admin listing)
export const GetAllWithDeleted = async () => {
  try {
    const credentials = await models.WrikeCredentials.findAll({
      where: { deleted_at: null },
      order: [["created_at", "DESC"]],
    });

    return credentials;
  } catch (err) {
    throw err;
  }
};

// Deactivate credentials by environment name
export const Deactivate = async (environmentName) => {
  try {
    if (!environmentName || typeof environmentName !== "string") {
      throw {
        statusCode: 400,
        message: "Invalid environment name",
      };
    }

    const updated = await models.WrikeCredentials.update(
      { is_active: false },
      {
        where: {
          environment_name: environmentName,
        },
        individualHooks: true,
      },
    );

    return updated;
  } catch (err) {
    throw err;
  }
};

// Get environments owned by a specific portal user
export const GetByOwnerId = async (ownerId) => {
  try {
    if (!ownerId)
      throw { statusCode: 400, message: "Owner id must not be empty" };

    const credentials = await models.WrikeCredentials.findAll({
      where: { owner_id: ownerId, deleted_at: null },
      order: [["created_at", "DESC"]],
    });

    return credentials;
  } catch (err) {
    throw err;
  }
};

// Get ALL non-deleted environments (for portal admin)
export const GetAllForPortal = async () => {
  try {
    const credentials = await models.WrikeCredentials.findAll({
      where: { deleted_at: null },
      order: [["created_at", "DESC"]],
    });
    return credentials;
  } catch (err) {
    throw err;
  }
};

// Soft delete by UUID with profile tracking
export const DeleteById = async (profile_id, id) => {
  try {
    if (!id) throw { statusCode: 420, message: "Id must not be empty" };

    const credential = await models.WrikeCredentials.findOne({
      where: { id, deleted_at: null },
    });

    if (!credential)
      throw { statusCode: 404, message: "Environment not found" };

    await credential.destroy({ profile_id });
    return credential;
  } catch (err) {
    throw err;
  }
};

// Soft delete credentials by UUID primary key
export const Delete = async (id) => {
  try {
    if (!id) {
      throw {
        statusCode: 420,
        message: "Id must not be empty!",
      };
    }

    const credential = await models.WrikeCredentials.findByPk(id);

    if (credential) {
      await credential.destroy();
    }

    return credential;
  } catch (err) {
    throw err;
  }
};
