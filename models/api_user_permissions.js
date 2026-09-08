"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class ApiUserPermissions extends Model {
    static associate(models) {
      ApiUserPermissions.belongsTo(models.WrikeCredentials, {
        as: "environment",
        foreignKey: "env_id",
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      });
      ApiUserPermissions.belongsTo(models.AdminUsers, {
        as: "creator",
        foreignKey: "created_by",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
      ApiUserPermissions.belongsTo(models.AdminUsers, {
        as: "updater",
        foreignKey: "updated_by",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    }
  }

  ApiUserPermissions.init(
    {
      id: {
        primaryKey: true,
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
      },
      env_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(320),
        allowNull: false,
        comment: "Lower-cased Wrike contact email this grant applies to",
      },
      display_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      can_read: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      can_create: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      can_update: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      can_delete: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_at: { type: DataTypes.DATE },
      updated_at: { type: DataTypes.DATE },
      deleted_at: { type: DataTypes.DATE },
      created_by: { type: DataTypes.UUID, allowNull: true },
      updated_by: { type: DataTypes.UUID, allowNull: true },
    },
    {
      sequelize,
      modelName: "ApiUserPermissions",
      tableName: "api_user_permissions",
      underscored: true,
      createdAt: false,
      updatedAt: false,
      paranoid: true,
      deletedAt: "deleted_at",
    },
  );

  ApiUserPermissions.beforeCreate((data, options) => {
    data.created_at = new Date();
    data.created_by = options?.profile_id || null;
    if (data?.email) data.email = String(data.email).trim().toLowerCase();
  });

  ApiUserPermissions.beforeUpdate((data, options) => {
    data.updated_at = new Date();
    data.updated_by = options?.profile_id || null;
    if (data?.email) data.email = String(data.email).trim().toLowerCase();
  });

  return ApiUserPermissions;
};
