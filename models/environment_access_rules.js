"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class EnvironmentAccessRules extends Model {
    static associate(models) {
      EnvironmentAccessRules.belongsTo(models.WrikeCredentials, {
        as: "environment",
        foreignKey: "env_id",
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      });
      EnvironmentAccessRules.belongsTo(models.AdminUsers, {
        as: "creator",
        foreignKey: "created_by",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
      EnvironmentAccessRules.belongsTo(models.AdminUsers, {
        as: "updater",
        foreignKey: "updated_by",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    }
  }

  EnvironmentAccessRules.init(
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
        type: DataTypes.ENUM("email", "domain", "ip"),
        allowNull: false,
      },
      value: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment:
          "Lower-cased email/domain, or a bare IP / CIDR range for rule_type=ip",
      },
      label: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "Human note shown in the admin console",
      },
      applies_to: {
        type: DataTypes.ENUM("api", "mcp", "both"),
        allowNull: false,
        defaultValue: "both",
        comment: "Surface this entry grants: api (REST only), mcp, or both",
      },
      is_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "Admin on/off switch — a disabled rule never matches",
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
      modelName: "EnvironmentAccessRules",
      tableName: "environment_access_rules",
      underscored: true,
      createdAt: false,
      updatedAt: false,
      paranoid: true,
      deletedAt: "deleted_at",
    },
  );

  const normalise = (data) => {
    if (data?.value == null) return;
    const raw = String(data.value).trim();
    // IPs/CIDRs are case-insensitive too (IPv6 hex), but lower-casing is a
    // no-op for the vast majority (IPv4) and harmless for the rest.
    data.value =
      data.rule_type === "domain" ? raw.replace(/^@+/, "").toLowerCase() : raw.toLowerCase();
  };

  EnvironmentAccessRules.beforeCreate((data, options) => {
    data.created_at = new Date();
    data.created_by = options?.profile_id || null;
    normalise(data);
  });

  EnvironmentAccessRules.beforeUpdate((data, options) => {
    data.updated_at = new Date();
    data.updated_by = options?.profile_id || null;
    normalise(data);
  });

  return EnvironmentAccessRules;
};
