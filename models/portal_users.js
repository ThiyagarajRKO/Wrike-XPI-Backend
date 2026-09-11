"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class PortalUsers extends Model {
    static associate(models) {
      PortalUsers.belongsToMany(models.WrikeCredentials, {
        as: "environments",
        through: models.PortalUserEnvironments,
        foreignKey: "user_id",
        otherKey: "env_id",
      });

      PortalUsers.belongsTo(models.AdminUsers, {
        as: "creator",
        foreignKey: "created_by",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });

      PortalUsers.belongsTo(models.AdminUsers, {
        as: "updater",
        foreignKey: "updated_by",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });

      PortalUsers.belongsTo(models.AdminUsers, {
        as: "deleter",
        foreignKey: "deleted_by",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    }
  }

  PortalUsers.init(
    {
      id: {
        primaryKey: true,
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
      },
      username: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      password_hash: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      role: {
        type: DataTypes.ENUM("admin", "user"),
        allowNull: false,
        defaultValue: "user",
      },
      must_change_password: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      full_name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      last_login_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
      },
      updated_at: {
        type: DataTypes.DATE,
      },
      deleted_at: {
        type: DataTypes.DATE,
      },
      created_by: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      updated_by: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      deleted_by: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "PortalUsers",
      tableName: "portal_users",
      underscored: true,
      createdAt: false,
      updatedAt: false,
      paranoid: true,
      deletedAt: "deleted_at",
    },
  );

  PortalUsers.beforeCreate((data, options) => {
    try {
      data.created_at = new Date();
      data.created_by = options?.profile_id || null;
      if (data?.email) {
        data.email = data.email.toLowerCase();
      }
      if (data?.username) {
        data.username = data.username.toLowerCase();
      }
    } catch (err) {
      console.log("Error while creating a portal user", err?.message || err);
    }
  });

  PortalUsers.beforeUpdate(async (data, options) => {
    try {
      data.updated_at = new Date();
      data.updated_by = options?.profile_id || null;
    } catch (err) {
      console.log("Error while updating a portal user", err?.message || err);
    }
  });

  PortalUsers.afterDestroy(async (data, options) => {
    try {
      data.is_active = false;
      data.deleted_by = options?.profile_id || null;
      await data.save({ profile_id: options?.profile_id });
    } catch (err) {
      console.log("Error while deleting a portal user", err?.message || err);
    }
  });

  return PortalUsers;
};
