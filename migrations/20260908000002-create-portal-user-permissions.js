"use strict";

/**
 * Module-level RBAC for portal users.
 *
 * One row per (user, module) rather than a JSON blob on portal_users: it keeps
 * the grant queryable ("who can delete environments?"), lets a single module
 * be revoked without rewriting the whole matrix, and carries its own audit
 * columns so a change is attributable.
 *
 * Roles (src/utils/permissionCatalog.js) are presets that write these rows —
 * they are deliberately not stored as a foreign key, so an admin can deviate
 * from a role and the console can honestly label the result "Custom" instead
 * of showing a role name that no longer describes the access.
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
      // Validated against permissionCatalog.MODULE_KEYS in the controller
      // rather than a DB enum, so adding a module is a code change and not a
      // migration + enum alter on a live table.
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

    // The whole matrix for one user is read in a single query on every
    // permission check, so this is the index that matters.
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
