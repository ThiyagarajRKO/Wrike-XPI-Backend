"use strict";

/**
 * Which surface an allow-list entry governs: the REST API, the MCP endpoint,
 * or both.
 *
 * Until now every entry applied to both, so "both" is the default and every
 * existing row keeps its current behaviour. This is deliberately a property
 * OF an entry rather than a second entry: the unique index stays
 * (env_id, rule_type, value), so one address is listed once and the admin
 * picks where it applies, instead of the same address appearing twice with
 * two different scopes.
 *
 * Written as explicit SQL rather than queryInterface.addColumn: Sequelize
 * emits an unquoted literal for an ENUM column's defaultValue on Postgres
 * ("DEFAULT both"), which is a syntax error. The DO block makes creating the
 * type idempotent, since Postgres has no CREATE TYPE IF NOT EXISTS.
 */
const TYPE_NAME = "enum_environment_access_rules_applies_to";

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `DO $$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${TYPE_NAME}') THEN
             CREATE TYPE "${TYPE_NAME}" AS ENUM ('api', 'mcp', 'both');
           END IF;
         END $$;`,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE "environment_access_rules"
           ADD COLUMN IF NOT EXISTS "applies_to" "${TYPE_NAME}"
           NOT NULL DEFAULT 'both';`,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `COMMENT ON COLUMN "environment_access_rules"."applies_to" IS
           'Surface this entry grants access to: api (REST only), mcp (MCP only), both';`,
        { transaction },
      );
    });
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `ALTER TABLE "environment_access_rules" DROP COLUMN IF EXISTS "applies_to";`,
        { transaction },
      );
      await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${TYPE_NAME}";`, {
        transaction,
      });
    });
  },
};
