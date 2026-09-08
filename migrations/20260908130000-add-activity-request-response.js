"use strict";

/**
 * Adds request/response detail capture plus a module category to the API/MCP
 * audit log, so the console can show what a caller actually sent and got back
 * as readable, beautified JSON. All new columns are nullable — pre-existing
 * rows simply carry NULLs (the UI shows "not captured" for them).
 *
 * up() is idempotent: it checks the live table first and only adds columns
 * that are missing, so it is safe both on a fresh migration chain and on a
 * database whose schema was already brought up to date by model sync.
 */
const ADD_COLUMNS = [
  {
    name: "category",
    definition: (Sequelize) => ({
      type: Sequelize.STRING(32),
      allowNull: true,
      comment:
        "Module category: campaign | channel | task | token | master | amoeba | mcp",
    }),
  },
  {
    name: "request_payload",
    definition: (Sequelize) => ({
      type: Sequelize.JSONB,
      allowNull: true,
      comment:
        "Sanitised, bounded snapshot of the request (headers/query/params/body)",
    }),
  },
  {
    name: "response_payload",
    definition: (Sequelize) => ({
      type: Sequelize.JSONB,
      allowNull: true,
      comment: "Sanitised, bounded snapshot of the response (status + body)",
    }),
  },
];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = await queryInterface.describeTable("api_activity_logs");
    for (const { name, definition } of ADD_COLUMNS) {
      if (!table[name]) {
        await queryInterface.addColumn(
          "api_activity_logs",
          name,
          definition(Sequelize),
        );
      }
    }
  },
  down: async (queryInterface) => {
    for (const { name } of ADD_COLUMNS.slice().reverse()) {
      try {
        await queryInterface.removeColumn("api_activity_logs", name);
      } catch {
        // column may not exist — nothing to remove
      }
    }
  },
};
