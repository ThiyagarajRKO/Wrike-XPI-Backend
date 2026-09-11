import models from "../../models";

export const Insert = async (data, options = {}) => {
  try {
    const userData = await models.PortalUsers.create(data, options);
    return userData;
  } catch (err) {
    throw err;
  }
};

export const GetByUsername = async (username) => {
  try {
    if (!username)
      throw { statusCode: 400, message: "Username must not be empty" };

    const user = await models.PortalUsers.findOne({
      attributes: [
        "id",
        "username",
        "password_hash",
        "role",
        "must_change_password",
        "full_name",
        "email",
        "is_active",
      ],
      where: { username: username.toLowerCase(), deleted_at: null },
    });

    return user;
  } catch (err) {
    throw err;
  }
};

export const GetById = async (id) => {
  try {
    if (!id) throw { statusCode: 400, message: "Id must not be empty" };

    const user = await models.PortalUsers.findOne({
      attributes: [
        "id",
        "username",
        "role",
        "must_change_password",
        "is_active",
      ],
      where: { id, is_active: true, deleted_at: null },
    });

    return {
      id: user?.id,
      username: user?.username,
      role: user?.role,
      must_change_password: user?.must_change_password,
      is_active: user?.is_active,
    };
  } catch (err) {
    throw err;
  }
};

export const GetAll = async () => {
  try {
    const users = await models.PortalUsers.findAll({
      attributes: [
        "id",
        "username",
        "role",
        "full_name",
        "email",
        "is_active",
        "must_change_password",
        "last_login_at",
        "created_at",
        "created_by",
      ],
      where: { deleted_at: null },
      order: [["created_at", "DESC"]],
    });
    return users;
  } catch (err) {
    throw err;
  }
};

export const Update = async (profile_id, id, data, options = {}) => {
  try {
    if (!id) throw { statusCode: 400, message: "Id must not be empty" };

    await models.PortalUsers.update(data, {
      where: { id, deleted_at: null },
      individualHooks: true,
      profile_id,
      ...options,
    });
  } catch (err) {
    throw err;
  }
};

export const UpdateLastLogin = async (id) => {
  try {
    await models.PortalUsers.update(
      { last_login_at: new Date() },
      { where: { id } },
    );
  } catch (err) {
    throw err;
  }
};

export const Delete = async (profile_id, id) => {
  try {
    if (!id) throw { statusCode: 400, message: "Id must not be empty" };

    const user = await models.PortalUsers.findOne({
      where: { id, deleted_at: null },
    });
    if (!user) throw { statusCode: 404, message: "User not found" };

    await user.destroy({ profile_id });
  } catch (err) {
    throw err;
  }
};

// ─── User-Environment mappings (via portal_user_environments) ────────────────
// One environment can be mapped to many portal users at once — each mapping
// is its own soft-deletable row, so revoking one user's access never affects
// anyone else's.

export const GetUserEnvironments = async (userId) => {
  try {
    const mappings = await models.PortalUserEnvironments.findAll({
      attributes: [],
      where: { user_id: userId, deleted_at: null },
      include: [
        {
          model: models.WrikeCredentials,
          as: "environment",
          attributes: [
            "id",
            "environment_name",
            "is_active",
            "is_visible",
            "account_id",
          ],
          where: { is_active: true, deleted_at: null },
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

export const AssignEnvironment = async (profile_id, userId, environmentId) => {
  try {
    const env = await models.WrikeCredentials.findOne({
      where: { id: environmentId, deleted_at: null },
    });
    if (!env) throw { statusCode: 404, message: "Environment not found" };

    const existing = await models.PortalUserEnvironments.findOne({
      where: { user_id: userId, env_id: environmentId },
      paranoid: false,
    });

    if (existing) {
      if (!existing.deleted_at) return; // already mapped — idempotent no-op

      await existing.restore();
      existing.updated_by = profile_id;
      await existing.save({ profile_id });
      return;
    }

    await models.PortalUserEnvironments.create(
      { user_id: userId, env_id: environmentId },
      { profile_id },
    );
  } catch (err) {
    throw err;
  }
};

export const RevokeEnvironment = async (userId, environmentId) => {
  try {
    const mapping = await models.PortalUserEnvironments.findOne({
      where: { user_id: userId, env_id: environmentId },
    });
    if (!mapping)
      throw { statusCode: 404, message: "Environment assignment not found" };

    await mapping.destroy();
  } catch (err) {
    throw err;
  }
};
