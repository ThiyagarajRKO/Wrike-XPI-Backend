"use strict";

/**
 * Environment-level API access scope: an allow list of emails, domains, and
 * IP addresses (or CIDR ranges) for one environment. A caller is let through
 * if they match ANY active, enabled entry — no match, no access. This is the
 * one and only gate for now; per-user CRUD and a second custom-field gate are
 * explicitly out of scope for this pass.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("environment_access_rules", {
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
        type: Sequelize.ENUM("email", "domain", "ip"),
        allowNull: false,
      },
      // Stored lower-cased for email/domain (case-insensitive match); ip
      // holds a bare address or CIDR ("203.0.113.4" or "203.0.113.0/24").
      // 64 chars comfortably covers the longest legal IPv6 CIDR and any
      // realistic email/domain.
      value: {
        type: Sequelize.STRING(255),
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

    // The hot path (every authenticated request) reads every live rule for
    // one environment in a single query.
    await queryInterface.addIndex(
      "environment_access_rules",
      ["env_id", "is_active"],
      { name: "environment_access_rules_env_active_idx" },
    );

    // One live rule per (environment, type, value) — re-adding a removed
    // entry after a soft delete is still allowed.
    await queryInterface.addIndex(
      "environment_access_rules",
      ["env_id", "rule_type", "value"],
      {
        unique: true,
        name: "environment_access_rules_env_value_unique_idx",
        where: { deleted_at: null },
      },
    );
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex(
      "environment_access_rules",
      "environment_access_rules_env_value_unique_idx",
    );
    await queryInterface.removeIndex(
      "environment_access_rules",
      "environment_access_rules_env_active_idx",
    );
    await queryInterface.dropTable("environment_access_rules");
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_environment_access_rules_rule_type";',
    );
  },
};
