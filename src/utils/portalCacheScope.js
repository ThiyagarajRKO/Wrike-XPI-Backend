import { WrikeCredentials } from "../controllers";

/**
 * Which Redis keys a portal user may see or delete.
 *
 * The cache is one global keyspace: an entry carries no record of the
 * environment it came from, and several prefixes carry no identity at all
 * (`space_datahub`, `entity_datahub`, `wrike-mcp-tools:<sha256>`). So unlike
 * Environments, Activity Logs and Environment Access — which scope by
 * portal_user_environments mappings — the cache cannot be scoped by
 * ownership. What it can do is
 * admit only the entries that are positively attributable to an environment
 * the caller owns: a key is theirs when one of its colon-delimited segments
 * equals an identifier from one of their environment records.
 *
 * Default-deny by design. A key this rule cannot attribute — a new prefix, a
 * global lookup, another tenant's data — is hidden and undeletable rather
 * than exposed, so a key shape added later is invisible to the portal until
 * it is deliberately covered, never leaked. The admin console
 * (verifyAdminJWT) keeps the unscoped view, which is where global entries are
 * meant to be inspected.
 *
 * Every environment identifier that can appear inside a cache key. Keys are
 * built as `prefix:param:param` from these same values — see
 * redisClient.generateKey and its call sites in src/utils/wrike.js,
 * src/routes/amoeba and src/mcp/wrikeMcpProxy.js.
 */
const IDENTITY_FIELDS = [
  "xpi_api_modules_datahub_id",
  "xpi_api_services_datahub_id",
  "xpi_entity_datahub_id",
  "xpi_field_mapping_datahub_id",
  "xpi_request_form_field_mapping_datahub_id",
  "xpi_request_form_mapping_datahub_id",
  "xpi_space_name_datahub_id",
  "campaign_space_id",
  "account_id",
];

/** Every key segment that could identify this caller's data. */
export const ownedCacheIdentifiers = async (portalUser) => {
  const environments =
    portalUser.role === "admin"
      ? await WrikeCredentials.GetAllForPortal()
      : await WrikeCredentials.GetByOwnerId(portalUser.id);

  const identifiers = new Set();

  for (const env of environments || []) {
    if (env?.id) identifiers.add(String(env.id));

    for (const field of IDENTITY_FIELDS) {
      const value = env?.[field];
      if (
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ""
      ) {
        identifiers.add(String(value).trim());
      }
    }
  }

  return identifiers;
};

/**
 * The predicate `listCacheEntries` and the delete routes share. Admin-role
 * portal users are unrestricted, matching every other portal module's admin
 * bypass; everyone else gets the attribution rule above.
 */
export const cacheKeyFilterFor = async (portalUser) => {
  if (portalUser?.role === "admin") return () => true;

  const identifiers = await ownedCacheIdentifiers(portalUser);
  if (!identifiers.size) return () => false;

  return (key) =>
    String(key)
      .split(":")
      .some((segment) => identifiers.has(segment));
};
