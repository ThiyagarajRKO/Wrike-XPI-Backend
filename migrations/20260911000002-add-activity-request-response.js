"use strict";

/**
 * Adds request/response detail capture plus a module category to the API/MCP
 * audit log, so the console can show what a caller actually sent and got back
 * as readable, beautified JSON. All new columns are nullable, so pre-existing
 * rows simply carry NULLs (the UI shows "not captured" for them).
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("api_activity_logs", "category", {
      type: Sequelize.STRING(32),
      allowNull: true,
      comment:
        "Module category: campaign | channel | task | token | master | amoeba | mcp",
    });
    await queryInterface.addColumn("api_activity_logs", "request_payload", {
      type: Sequelize.JSONB,
      allowNull: true,
      comment:
        "Sanitised, bounded snapshot of the request (headers/query/params/body)",
    });
    await queryInterface.addColumn("api_activity_logs", "response_payload", {
      type: Sequelize.JSONB,
      allowNull: true,
      comment: "Sanitised, bounded snapshot of the response (status + body)",
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("api_activity_logs", "response_payload");
    await queryInterface.removeColumn("api_activity_logs", "request_payload");
    await queryInterface.removeColumn("api_activity_logs", "category");
  },
};
