"use strict";

/**
 * Two per-environment master switches for the API access gates
 * (src/utils/environmentAccess.js):
 *
 *   allowlist_check_enabled    Gate 1 — the email/domain/IP allow list.
 *                              Off means every caller passes this gate for
 *                              this environment, allow-list rows notwithstanding.
 *   custom_field_check_enabled Gate 2 — the Wrike "Xtend API" custom field
 *                              check. Stored now so the setting exists and is
 *                              visible in the console; the check itself is a
 *                              phase-2 addition and is not enforced by this
 *                              migration alone — see environmentAccess.js.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("wrike_credentials", "allowlist_check_enabled", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await queryInterface.addColumn("wrike_credentials", "custom_field_check_enabled", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("wrike_credentials", "custom_field_check_enabled");
    await queryInterface.removeColumn("wrike_credentials", "allowlist_check_enabled");
  },
};
