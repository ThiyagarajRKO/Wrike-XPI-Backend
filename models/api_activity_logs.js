"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class ApiActivityLogs extends Model {
    static associate(models) {
      ApiActivityLogs.belongsTo(models.WrikeCredentials, {
        as: "environment",
        foreignKey: "env_id",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    }
  }

  ApiActivityLogs.init(
    {
      id: {
        primaryKey: true,
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
      },
      env_id: { type: DataTypes.UUID, allowNull: true },
      environment_name: { type: DataTypes.STRING(255), allowNull: true },
      surface: { type: DataTypes.ENUM("rest", "mcp"), allowNull: false },
      actor_email: { type: DataTypes.STRING(320), allowNull: true },
      action: { type: DataTypes.STRING(16), allowNull: true },
      resource: { type: DataTypes.STRING(255), allowNull: false },
      method: { type: DataTypes.STRING(8), allowNull: true },
      allowed: { type: DataTypes.BOOLEAN, allowNull: false },
      code: { type: DataTypes.STRING(64), allowNull: true },
      status_code: { type: DataTypes.INTEGER, allowNull: true },
      ip: { type: DataTypes.STRING(64), allowNull: true },
      created_at: { type: DataTypes.DATE },
    },
    {
      sequelize,
      modelName: "ApiActivityLogs",
      tableName: "api_activity_logs",
      underscored: true,
      createdAt: "created_at",
      updatedAt: false,
    },
  );

  return ApiActivityLogs;
};
