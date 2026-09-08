"use strict";

/**
 * Module-level permissions for portal users: one row per (user, module),
 * each carrying its own Read/Create/Update/Delete grant. A user with no rows
 * for a module simply has no access to it — there is no separate "enabled"
 * flag to fall out of sync with the booleans.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("portal_user_permissions", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "portal_users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      // Validated against the module list in
      // src/utils/portalPermissionCatalog.js in the controller, rather than a
      // DB enum — adding a module is then a code change, not a migration.
      module: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      can_read: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn("now"),
        allowNull: false,
      },
      updated_at: { type: Sequelize.DATE, allowNull: true },
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

    // The whole matrix for one user is read in a single query, every time
    // the permissions icon is opened.
    await queryInterface.addIndex("portal_user_permissions", ["user_id"], {
      name: "portal_user_permissions_user_idx",
    });

    await queryInterface.addIndex(
      "portal_user_permissions",
      ["user_id", "module"],
      { unique: true, name: "portal_user_permissions_user_module_unique_idx" },
    );
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex(
      "portal_user_permissions",
      "portal_user_permissions_user_module_unique_idx",
    );
    await queryInterface.removeIndex(
      "portal_user_permissions",
      "portal_user_permissions_user_idx",
    );
    await queryInterface.dropTable("portal_user_permissions");
  },
};
