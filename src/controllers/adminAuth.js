import models from "../../models";

export const Insert = async (username, passwordHash) => {
  try {
    const admin = await models.AdminUsers.create({
      username,
      password_hash: passwordHash,
      totp_enabled: false,
    });

    return {
      id: admin.id,
      username: admin.username,
    };
  } catch (err) {
    throw err;
  }
};

export const GetByUsername = async (username) => {
  try {
    if (!username) {
      throw {
        statusCode: 420,
        message: "Username must not be empty!",
      };
    }

    const admin = await models.AdminUsers.findOne({
      attributes: [
        "id",
        "username",
        "password_hash",
        "totp_enabled",
        "totp_secret",
      ],
      where: { username, is_active: true },
    });

    return {
      id: admin?.id,
      username: admin?.username,
      password_hash: admin?.password_hash,
      totp_enabled: admin?.totp_enabled,
      totp_secret: admin?.totp_secret,
    };
  } catch (err) {
    throw err;
  }
};

export const GetById = async (id) => {
  try {
    if (!id) {
      throw {
        statusCode: 420,
        message: "Id must not be empty!",
      };
    }

    const admin = await models.AdminUsers.findOne({
      attributes: ["id", "username", "totp_enabled", "totp_secret"],
      where: { id, is_active: true },
    });

    return {
      id: admin?.id,
      username: admin?.username,
      totp_enabled: admin?.totp_enabled,
      totp_secret: admin?.totp_secret,
    };
  } catch (err) {
    throw err;
  }
};

export const GetAuthById = async (id) => {
  try {
    if (!id) {
      throw {
        statusCode: 420,
        message: "Id must not be empty!",
      };
    }

    const admin = await models.AdminUsers.findOne({
      attributes: [
        "id",
        "username",
        "password_hash",
        "totp_enabled",
        "totp_secret",
      ],
      where: { id, is_active: true },
    });

    return {
      id: admin?.id,
      username: admin?.username,
      password_hash: admin?.password_hash,
      totp_enabled: admin?.totp_enabled,
      totp_secret: admin?.totp_secret,
    };
  } catch (err) {
    throw err;
  }
};

export const Count = async () => {
  try {
    return await models.AdminUsers.count();
  } catch (err) {
    throw err;
  }
};

export const EnableTOTP = async (id, totpSecret) => {
  try {
    await models.AdminUsers.update(
      { totp_secret: totpSecret, totp_enabled: true },
      { where: { id } },
    );
  } catch (err) {
    throw err;
  }
};

export const DisableTOTP = async (id) => {
  try {
    await models.AdminUsers.update(
      { totp_secret: null, totp_enabled: false },
      { where: { id } },
    );
  } catch (err) {
    throw err;
  }
};

export const UpdateLastLogin = async (id) => {
  try {
    await models.AdminUsers.update(
      { last_login_at: new Date() },
      { where: { id } },
    );
  } catch (err) {
    throw err;
  }
};
