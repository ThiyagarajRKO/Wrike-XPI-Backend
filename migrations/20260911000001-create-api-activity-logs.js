"use strict";

/**
 * One row per API/MCP call: who called, what they called, whether the
 * security gates let it through, and what the caller got back. Append-only —
 * nothing here is ever updated, only inserted and, eventually, purged by
 * retention (see src/utils/activityLog.js).
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("api_activity_logs", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      env_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "wrike_credentials", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      environment_name: {
        // Denormalised: kept even if the environment is later renamed or
        // deleted, so old log rows still read sensibly.
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      surface: {
        type: Sequelize.ENUM("rest", "mcp"),
        allowNull: false,
      },
      actor_email: {
        type: Sequelize.STRING(320),
        allowNull: true,
      },
      action: {
        // read | create | update | delete — the CRUD action the gates judged
        type: Sequelize.STRING(16),
        allowNull: true,
      },
      resource: {
        // REST: request path. MCP: tool name.
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      method: {
        // REST: HTTP method. MCP: null (there is no verb, only the tool).
        type: Sequelize.STRING(8),
        allowNull: true,
      },
      allowed: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
      },
      code: {
        // The gate decision code (ALLOWED, NOT_ALLOWED, PERMISSION_DENIED, ...)
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      status_code: {
        // REST only — the actual HTTP response status. Null for MCP, where a
        // tool call's own JSON-RPC result carries success/error instead.
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      ip: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn("now"),
        allowNull: false,
      },
    });

    // The admin viewer's default query: one environment, newest first.
    await queryInterface.addIndex("api_activity_logs", ["env_id", "created_at"], {
      name: "api_activity_logs_env_created_idx",
    });

    // What the retention sweep scans on every run, app-wide.
    await queryInterface.addIndex("api_activity_logs", ["created_at"], {
      name: "api_activity_logs_created_idx",
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex("api_activity_logs", "api_activity_logs_created_idx");
    await queryInterface.removeIndex("api_activity_logs", "api_activity_logs_env_created_idx");
    await queryInterface.dropTable("api_activity_logs");
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_api_activity_logs_surface";');
  },
};
