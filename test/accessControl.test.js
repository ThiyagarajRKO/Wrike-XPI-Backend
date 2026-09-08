/* Exercises the three authorization gates against stubbed data.
   Run from the repo root:  node test/accessControl.test.js
   No database, Redis or Wrike account required — the controller and the two
   Wrike calls are stubbed, so this exercises the decision logic alone. */

require("@babel/register")({
  presets: [["@babel/preset-env", { targets: { node: "current" } }]],
});
process.on("unhandledRejection", () => {});

// Keep the L1 cache out of the way so each scenario is evaluated fresh.
process.env.ACCESS_MEMORY_TTL = "1";

const ENV = "11111111-1111-1111-1111-111111111111";

/* ── Stubs ─────────────────────────────────────────────────────────────── */

const apiAccess = require("../src/controllers/apiAccess");
const wrike = require("../src/utils/wrike");

let RULES = [];
let PERMS = [];
let CONTACT = null;

apiAccess.GetRulesByEnv = async () => RULES;
apiAccess.GetPermissionsByEnv = async () => PERMS;

wrike.getCustomFields = async () => ({
  data: [
    { id: "CF-XTEND", title: "Xtend API" },
    { id: "CF-OTHER", title: "Something else" },
  ],
});
wrike.getUserProfileWithCustomFields = async () => CONTACT;

const ac = require("../src/utils/accessControl");

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const rule = (over = {}) => ({
  id: "r-" + (over.value || "x"),
  env_id: ENV,
  rule_type: "email",
  value: "alex@company.com",
  label: null,
  is_enabled: true,
  can_read: true,
  can_create: false,
  can_update: false,
  can_delete: false,
  ...over,
});

const contact = (email, xtend) => ({
  data: [
    {
      id: "KUAAAAAA",
      primaryEmail: email,
      firstName: "Alex",
      lastName: "Morgan",
      customFields: xtend === undefined ? [] : [{ id: "CF-XTEND", value: xtend }],
    },
  ],
});

/* ── Harness ───────────────────────────────────────────────────────────── */

let pass = 0;
let fail = 0;

const check = (label, actual, expected) => {
  if (actual === expected) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}\n          got ${actual}, expected ${expected}`);
  }
};

async function scenario(name, { rules, perms, email, xtend, action }, expected) {
  RULES = rules;
  PERMS = perms || [];
  CONTACT = contact(email, xtend);

  // Each scenario is a different configuration of the same environment, so
  // the compiled indexes from the previous one have to go — exactly what an
  // admin write does in production.
  await ac.invalidateEnvironment(ENV);

  // A fresh token each run so the profile cache never bleeds between cases.
  const decision = await ac.evaluateAccess({
    envId: ENV,
    environmentName: "test",
    wrikeToken: `token-${name}-${Math.random()}`,
    action,
  });

  check(name, decision.code, expected.code);
  if (expected.allowed !== undefined) {
    check(`${name} · allowed`, decision.allowed, expected.allowed);
  }
}

(async () => {
  console.log("\nGate 1 — allow list");
  await scenario(
    "unlisted email is refused",
    { rules: [], email: "stranger@other.com", xtend: "Enabled", action: "read" },
    { code: "NOT_WHITELISTED", allowed: false },
  );
  await scenario(
    "listed email passes",
    {
      rules: [rule()],
      email: "alex@company.com",
      xtend: "Enabled",
      action: "read",
    },
    { code: "ALLOWED", allowed: true },
  );
  await scenario(
    "domain rule covers a whole company",
    {
      rules: [rule({ rule_type: "domain", value: "company.com" })],
      email: "someone.new@company.com",
      xtend: "Enabled",
      action: "read",
    },
    { code: "ALLOWED", allowed: true },
  );
  await scenario(
    "switched-off entry is refused",
    {
      rules: [rule({ is_enabled: false })],
      email: "alex@company.com",
      xtend: "Enabled",
      action: "read",
    },
    { code: "ALLOWLIST_DISABLED", allowed: false },
  );
  await scenario(
    "email is matched case-insensitively",
    {
      rules: [rule()],
      email: "ALEX@Company.com",
      xtend: "Enabled",
      action: "read",
    },
    { code: "ALLOWED", allowed: true },
  );

  console.log("\nGate 2 — Xtend API custom field");
  await scenario(
    "field set to Disabled is refused",
    {
      rules: [rule()],
      email: "alex@company.com",
      xtend: "Disabled",
      action: "read",
    },
    { code: "CUSTOM_FIELD_DISABLED", allowed: false },
  );
  await scenario(
    "field absent is refused",
    { rules: [rule()], email: "alex@company.com", action: "read" },
    { code: "CUSTOM_FIELD_MISSING", allowed: false },
  );
  await scenario(
    "field empty is refused",
    { rules: [rule()], email: "alex@company.com", xtend: "", action: "read" },
    { code: "CUSTOM_FIELD_MISSING", allowed: false },
  );
  await scenario(
    "field value is matched case-insensitively",
    {
      rules: [rule()],
      email: "alex@company.com",
      xtend: "ENABLED",
      action: "read",
    },
    { code: "ALLOWED", allowed: true },
  );

  console.log("\nGate 3 — permissions");
  await scenario(
    "baseline denies an ungranted action",
    {
      rules: [rule()],
      email: "alex@company.com",
      xtend: "Enabled",
      action: "delete",
    },
    { code: "PERMISSION_DENIED", allowed: false },
  );
  await scenario(
    "baseline allows a granted action",
    {
      rules: [rule({ can_create: true })],
      email: "alex@company.com",
      xtend: "Enabled",
      action: "create",
    },
    { code: "ALLOWED", allowed: true },
  );
  await scenario(
    "per-user grant overrides the baseline upward",
    {
      rules: [rule()],
      perms: [
        {
          id: "p1",
          env_id: ENV,
          email: "alex@company.com",
          display_name: null,
          can_read: true,
          can_create: false,
          can_update: false,
          can_delete: true,
        },
      ],
      email: "alex@company.com",
      xtend: "Enabled",
      action: "delete",
    },
    { code: "ALLOWED", allowed: true },
  );
  await scenario(
    "per-user grant overrides the baseline downward",
    {
      rules: [rule({ can_delete: true })],
      perms: [
        {
          id: "p1",
          env_id: ENV,
          email: "alex@company.com",
          display_name: null,
          can_read: true,
          can_create: false,
          can_update: false,
          can_delete: false,
        },
      ],
      email: "alex@company.com",
      xtend: "Enabled",
      action: "delete",
    },
    { code: "PERMISSION_DENIED", allowed: false },
  );

  console.log("\nPrecedence");
  await scenario(
    "an exact email rule beats the domain rule",
    {
      rules: [
        rule({
          rule_type: "domain",
          value: "company.com",
          can_delete: true,
          id: "r-domain",
        }),
        rule({ can_delete: false, id: "r-email" }),
      ],
      email: "alex@company.com",
      xtend: "Enabled",
      action: "delete",
    },
    { code: "PERMISSION_DENIED", allowed: false },
  );
  await scenario(
    "the allow list is checked before the custom field",
    { rules: [], email: "alex@company.com", xtend: "Disabled", action: "read" },
    { code: "NOT_WHITELISTED", allowed: false },
  );

  console.log("\nMCP connect path (no action)");
  RULES = [rule({ can_create: true, can_read: false })];
  PERMS = [];
  CONTACT = contact("alex@company.com", "Enabled");
  await ac.invalidateEnvironment(ENV);
  const ctx = await ac.resolveAccessContext({
    envId: ENV,
    environmentName: "test",
    wrikeToken: "token-ctx-" + Math.random(),
  });
  check("connects a caller who cannot read but can create", ctx.allowed, true);
  check("carries the create grant", ctx.permissions.create, true);
  check("carries the read denial", ctx.permissions.read, false);

  console.log("\nSimulator");
  RULES = [rule({ can_update: true })];
  PERMS = [];
  await ac.invalidateEnvironment(ENV);
  const sim = await ac.simulateAccess({ envId: ENV, email: "alex@company.com" });
  check("reports the custom field as pending", sim.gates[2].status, "pending");
  check("resolves the baseline grant", sim.permissions.update, true);
  const simDenied = await ac.simulateAccess({
    envId: ENV,
    email: "nobody@elsewhere.com",
  });
  check("refuses an unlisted address", simDenied.code, "NOT_WHITELISTED");
  check("skips gates after the refusal", simDenied.gates[2].status, "skipped");

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
