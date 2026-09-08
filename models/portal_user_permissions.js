"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class PortalUserPermissions extends Model {
    static associate(models) {
      PortalUserPermissions.belongsTo(models.PortalUsers, {
        as: "user",
        foreignKey: "user_id",
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      });
      PortalUserPermissions.belongsTo(models.AdminUsers, {
        as: "creator",
        foreignKey: "created_by",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
      PortalUserPermissions.belongsTo(models.AdminUsers, {
        as: "updater",
        foreignKey: "updated_by",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    }
  }

  PortalUserPermissions.init(
    {
      id: {
        primaryKey: true,
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      module: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: "Module key from src/utils/permissionCatalog.js",
      },
      can_read: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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
      created_at: { type: DataTypes.DATE },
      updated_at: { type: DataTypes.DATE },
      created_by: { type: DataTypes.UUID, allowNull: true },
      updated_by: { type: DataTypes.UUID, allowNull: true },
    },
    {
      sequelize,
      modelName: "PortalUserPermissions",
      tableName: "portal_user_permissions",
      underscored: true,
      createdAt: false,
      updatedAt: false,
    },
  );

  PortalUserPermissions.beforeCreate((data, options) => {
    data.created_at = new Date();
    data.created_by = options?.profile_id || null;
  });

  PortalUserPermissions.beforeUpdate((data, options) => {
    data.updated_at = new Date();
    data.updated_by = options?.profile_id || null;
  });

  return PortalUserPermissions;
};
