"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class WrikeCredentials extends Model {
    static associate(models) {
      WrikeCredentials.hasMany(models.UserTokens, {
        as: "tokens",
        foreignKey: "env_id",
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      });
      WrikeCredentials.belongsToMany(models.PortalUsers, {
        as: "owners",
        through: models.PortalUserEnvironments,
        foreignKey: "env_id",
        otherKey: "user_id",
      });
      WrikeCredentials.belongsTo(models.AdminUsers, {
        as: "creator",
        foreignKey: "created_by",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
      WrikeCredentials.belongsTo(models.AdminUsers, {
        as: "updater",
        foreignKey: "updated_by",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    }
  }

  WrikeCredentials.init(
    {
      id: {
        primaryKey: true,
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
      },
      environment_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: "Unique environment name",
      },
      client_id: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Encrypted Client ID",
      },
      client_secret: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Encrypted Client Secret",
      },
      account_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "Wrike Account ID",
      },
      xpi_api_modules_datahub_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "XPI API Modules Datahub ID",
      },
      xpi_api_services_datahub_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "XPI API Services Datahub ID",
      },
      xpi_entity_datahub_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "XPI Entity Datahub ID",
      },
      xpi_field_mapping_datahub_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "XPI Field Mapping Datahub ID",
      },
      xpi_request_form_field_mapping_datahub_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "XPI Request Form Field Mapping Datahub ID",
      },
      xpi_request_form_mapping_datahub_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "XPI Request Form Mapping Datahub ID",
      },
      xpi_space_name_datahub_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "XPI Space Name Datahub ID",
      },
      campaign_space_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "Campaign Space ID for Wrike DataHub",
      },
      is_visible: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        comment: "Flag to control visibility of environment in UI dropdowns",
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      allowlist_check_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        comment: "Gate 1 master switch — email/domain/IP allow list (src/utils/environmentAccess.js)",
      },
      custom_field_check_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: "Gate 2 master switch — Wrike Xtend API custom field. Flag only; enforcement is phase 2.",
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
      },
      updated_by: {
        type: DataTypes.UUID,
      },
    },
    {
      sequelize,
      modelName: "WrikeCredentials",
      tableName: "wrike_credentials",
      underscored: true,
      createdAt: false,
      updatedAt: false,
      paranoid: true,
      deletedAt: "deleted_at",
    },
  );

  WrikeCredentials.beforeCreate((data, options) => {
    try {
      data.created_at = new Date();
      data.created_by = options?.profile_id;
    } catch (err) {
      console.log("Error while creating an user", err?.message || err);
    }
  });

  // Update Hook
  WrikeCredentials.beforeUpdate(async (data, options) => {
    try {
      data.updated_at = new Date();
      data.updated_by = options.profile_id;
    } catch (err) {
      console.log("Error while updating an user", err?.message || err);
    }
  });

  // Delete Hook
  WrikeCredentials.afterDestroy(async (data, options) => {
    try {
      // data.deleted_by = options?.user_id;
      data.is_active = false;

      await data.save({ profile_id: options.profile_id });
    } catch (err) {
      console.log("Error while deleting a user token", err?.message || err);
    }
  });

  return WrikeCredentials;
};
