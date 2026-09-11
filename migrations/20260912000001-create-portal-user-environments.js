"use strict";

/**
 * Many-to-many environment <-> portal-user mapping. Replaces the single
 * wrike_credentials.owner_id column (one environment, one owner) with a join
 * table so an environment can be mapped to multiple portal users at once,
 * each managing it independently. Soft-deletable so a revoke keeps history
 * instead of disappearing — matches environment_access_rules.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("portal_user_environments", {
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
      env_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "wrike_credentials", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
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

    // "All environments for user X" — read every time the Map Environment
    // modal opens.
    await queryInterface.addIndex("portal_user_environments", ["user_id"], {
      name: "portal_user_environments_user_idx",
    });

    // "All users of environment Y" — read for the admin credentials list.
    await queryInterface.addIndex("portal_user_environments", ["env_id"], {
      name: "portal_user_environments_env_idx",
    });

    // One live mapping per (user, environment) — re-mapping after a past
    // revoke is still allowed.
    await queryInterface.addIndex(
      "portal_user_environments",
      ["user_id", "env_id"],
      {
        unique: true,
        name: "portal_user_environments_user_env_unique_idx",
        where: { deleted_at: null },
      },
    );

    // Backfill existing single-owner assignments into the join table.
    await queryInterface.sequelize.query(`
      INSERT INTO portal_user_environments (id, user_id, env_id, created_at)
      SELECT gen_random_uuid(), owner_id, id, now()
      FROM wrike_credentials
      WHERE owner_id IS NOT NULL
    `);

    await queryInterface.removeColumn("wrike_credentials", "owner_id");
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("wrike_credentials", "owner_id", {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: "portal_users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    // Best-effort backfill: a single owner_id can't represent multiple
    // mappings, so this arbitrarily picks one active mapping per environment.
    await queryInterface.sequelize.query(`
      UPDATE wrike_credentials wc
      SET owner_id = sub.user_id
      FROM (
        SELECT DISTINCT ON (env_id) env_id, user_id
        FROM portal_user_environments
        WHERE deleted_at IS NULL
        ORDER BY env_id, created_at ASC
      ) sub
      WHERE wc.id = sub.env_id
    `);

    await queryInterface.removeIndex(
      "portal_user_environments",
      "portal_user_environments_user_env_unique_idx",
    );
    await queryInterface.removeIndex(
      "portal_user_environments",
      "portal_user_environments_env_idx",
    );
    await queryInterface.removeIndex(
      "portal_user_environments",
      "portal_user_environments_user_idx",
    );
    await queryInterface.dropTable("portal_user_environments");
  },
};
