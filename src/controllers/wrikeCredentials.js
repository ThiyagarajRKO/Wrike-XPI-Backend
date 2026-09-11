import models from "../../models";
import { invalidateEnvironment } from "../utils/environmentAccessCache";

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

    // The access gate caches both security switches under one entry per
    // environment, so any update to this row drops it. Deliberately not
    // conditional on which fields changed: over-invalidating costs one query
    // on the next call, while missing a case leaves a stale allow-list
    // decision in place for up to a TTL. That asymmetry is the whole reason
    // this moved out of the route handler.
    await invalidateEnvironment(id);

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

// Get environments mapped to a specific portal user (via portal_user_environments)
export const GetByOwnerId = async (ownerId) => {
  try {
    if (!ownerId)
      throw { statusCode: 400, message: "Owner id must not be empty" };

    const mappings = await models.PortalUserEnvironments.findAll({
      attributes: [],
      where: { user_id: ownerId, deleted_at: null },
      include: [
        {
          model: models.WrikeCredentials,
          as: "environment",
          where: { deleted_at: null },
          required: true,
        },
      ],
      order: [["created_at", "DESC"]],
    });

    return mappings.map((m) => m.environment);
  } catch (err) {
    throw err;
  }
};

// Batch-resolve the portal users currently mapped to each of the given
// environment ids — used by the admin credentials list so it doesn't run
// one query per row.
export const GetOwnersByEnvIds = async (envIds) => {
  try {
    if (!envIds || !envIds.length) return {};

    const mappings = await models.PortalUserEnvironments.findAll({
      attributes: ["env_id"],
      where: { env_id: envIds, deleted_at: null },
      include: [
        {
          model: models.PortalUsers,
          as: "user",
          attributes: ["id", "username"],
          required: true,
        },
      ],
    });

    const byEnvId = {};
    for (const m of mappings) {
      if (!byEnvId[m.env_id]) byEnvId[m.env_id] = [];
      byEnvId[m.env_id].push({ id: m.user.id, username: m.user.username });
    }
    return byEnvId;
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
    await invalidateEnvironment(id);

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
      await invalidateEnvironment(id);
    }

    return credential;
  } catch (err) {
    throw err;
  }
};
