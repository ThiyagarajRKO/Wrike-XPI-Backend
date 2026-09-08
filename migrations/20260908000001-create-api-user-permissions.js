"use strict";

/**
 * Gate 3 of API/MCP authorization: the per-user, per-environment CRUD grant.
 *
 * A row here overrides whatever baseline the caller's matched allow-list rule
 * (api_access_rules) would have given them. No row means the baseline stands.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("api_user_permissions", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      env_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "wrike_credentials", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      // Stored lower-cased; matched against the Wrike contact's primary email.
      email: {
        type: Sequelize.STRING(320),
        allowNull: false,
      },
      display_name: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      can_read: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      can_create: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      can_update: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      can_delete: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn("now"),
        allowNull: false,
      },
      updated_at: { type: Sequelize.DATE, allowNull: true },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
      created_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "admin_users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      updated_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "admin_users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
    });

    await queryInterface.addIndex(
      "api_user_permissions",
      ["env_id", "is_active"],
      { name: "api_user_permissions_env_active_idx" },
    );

    await queryInterface.addIndex("api_user_permissions", ["env_id", "email"], {
      unique: true,
      name: "api_user_permissions_env_email_unique_idx",
      where: { deleted_at: null },
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex(
      "api_user_permissions",
      "api_user_permissions_env_email_unique_idx",
    );
    await queryInterface.removeIndex(
      "api_user_permissions",
      "api_user_permissions_env_active_idx",
    );
    await queryInterface.dropTable("api_user_permissions");
  },
};
