"use strict";

/**
 * Gate 1 of API/MCP authorization: the per-environment allow list.
 *
 * A rule matches a caller either by their exact Wrike email or by the domain
 * part of it. Each rule also carries the *baseline* CRUD grant handed to
 * everyone it matches — so "everyone @xtend.com gets read" is one row, not one
 * row per person. A matching row in api_user_permissions overrides that
 * baseline for a single caller.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("api_access_rules", {
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
      rule_type: {
        type: Sequelize.ENUM("email", "domain"),
        allowNull: false,
        defaultValue: "email",
      },
      // Stored lower-cased. "email" holds a full address, "domain" holds the
      // bare host ("xtend.com") with no leading "@".
      value: {
        type: Sequelize.STRING(320),
        allowNull: false,
      },
      label: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      is_enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    // The hot path reads every live rule for one environment in a single query.
    await queryInterface.addIndex("api_access_rules", ["env_id", "is_active"], {
      name: "api_access_rules_env_active_idx",
    });

    // One live rule per (environment, type, value). Partial so a soft-deleted
    // rule never blocks re-adding the same address later.
    await queryInterface.addIndex(
      "api_access_rules",
      ["env_id", "rule_type", "value"],
      {
        unique: true,
        name: "api_access_rules_env_value_unique_idx",
        where: { deleted_at: null },
      },
    );
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex(
      "api_access_rules",
      "api_access_rules_env_value_unique_idx",
    );
    await queryInterface.removeIndex(
      "api_access_rules",
      "api_access_rules_env_active_idx",
    );
    await queryInterface.dropTable("api_access_rules");
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_api_access_rules_rule_type";',
    );
  },
};
