"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class ApiAccessRules extends Model {
    static associate(models) {
      ApiAccessRules.belongsTo(models.WrikeCredentials, {
        as: "environment",
        foreignKey: "env_id",
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      });
      ApiAccessRules.belongsTo(models.AdminUsers, {
        as: "creator",
        foreignKey: "created_by",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
      ApiAccessRules.belongsTo(models.AdminUsers, {
        as: "updater",
        foreignKey: "updated_by",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    }
  }

  ApiAccessRules.init(
    {
      id: {
        primaryKey: true,
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
      },
      env_id: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "Environment this allow-list rule belongs to",
      },
      rule_type: {
        type: DataTypes.ENUM("email", "domain"),
        allowNull: false,
        defaultValue: "email",
      },
      value: {
        type: DataTypes.STRING(320),
        allowNull: false,
        comment: "Lower-cased email address, or bare domain with no leading @",
      },
      label: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "Human note shown in the admin console",
      },
      is_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "Admin on/off switch — a disabled rule never matches",
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
      modelName: "ApiAccessRules",
      tableName: "api_access_rules",
      underscored: true,
      createdAt: false,
      updatedAt: false,
      paranoid: true,
      deletedAt: "deleted_at",
    },
  );

  const normalise = (data) => {
    if (data?.value) data.value = String(data.value).trim().toLowerCase();
    if (data?.rule_type === "domain" && data?.value) {
      data.value = data.value.replace(/^@+/, "");
    }
  };

  ApiAccessRules.beforeCreate((data, options) => {
    data.created_at = new Date();
    data.created_by = options?.profile_id || null;
    normalise(data);
  });

  ApiAccessRules.beforeUpdate((data, options) => {
    data.updated_at = new Date();
    data.updated_by = options?.profile_id || null;
    normalise(data);
  });

  return ApiAccessRules;
};
