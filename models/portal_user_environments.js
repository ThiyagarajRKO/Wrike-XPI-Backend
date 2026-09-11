"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class PortalUserEnvironments extends Model {
    static associate(models) {
      PortalUserEnvironments.belongsTo(models.PortalUsers, {
        as: "user",
        foreignKey: "user_id",
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      });
      PortalUserEnvironments.belongsTo(models.WrikeCredentials, {
        as: "environment",
        foreignKey: "env_id",
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      });
      PortalUserEnvironments.belongsTo(models.AdminUsers, {
        as: "creator",
        foreignKey: "created_by",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
      PortalUserEnvironments.belongsTo(models.AdminUsers, {
        as: "updater",
        foreignKey: "updated_by",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    }
  }

  PortalUserEnvironments.init(
    {
      id: {
        primaryKey: true,
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "Portal user this mapping grants access to",
      },
      env_id: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "Environment this mapping grants access to",
      },
      created_at: { type: DataTypes.DATE },
      updated_at: { type: DataTypes.DATE },
      deleted_at: { type: DataTypes.DATE },
      created_by: { type: DataTypes.UUID, allowNull: true },
      updated_by: { type: DataTypes.UUID, allowNull: true },
    },
    {
      sequelize,
      modelName: "PortalUserEnvironments",
      tableName: "portal_user_environments",
      underscored: true,
      createdAt: false,
      updatedAt: false,
      paranoid: true,
      deletedAt: "deleted_at",
    },
  );

  PortalUserEnvironments.beforeCreate((data, options) => {
    data.created_at = new Date();
    data.created_by = options?.profile_id || null;
  });

  PortalUserEnvironments.beforeUpdate((data, options) => {
    data.updated_at = new Date();
    data.updated_by = options?.profile_id || null;
  });

  return PortalUserEnvironments;
};
