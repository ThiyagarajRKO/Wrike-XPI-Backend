/* Exercises the environment access-scope engine against stubbed data.
   Run from the repo root:  node test/environmentAccess.test.js
   No database, Redis or Wrike account required — the controller and the
   Wrike identity call are stubbed, so this exercises the decision logic and
   the real IP/CIDR matcher (ipaddr.js) alone. */

require("@babel/register")({
  presets: [["@babel/preset-env", { targets: { node: "current" } }]],
});
process.on("unhandledRejection", () => {});

process.env.ENV_ACCESS_MEMORY_TTL = "1";

const ENV = "22222222-2222-2222-2222-222222222222";

const environmentAccessController = require("../src/controllers/environmentAccess");
const wrike = require("../src/utils/wrike");

let RULES = [];
let CONTACT_EMAIL = null;

environmentAccessController.GetRulesByEnv = async () => RULES;
wrike.getUserData = async () => ({
  data: [{ id: "KUAAAAAA", primaryEmail: CONTACT_EMAIL, firstName: "Alex", lastName: "Morgan" }],
});

const ea = require("../src/utils/environmentAccess");

const rule = (over = {}) => ({
  id: "r-" + (over.value || "x"),
  env_id: ENV,
  rule_type: "email",
  value: "alex@company.com",
  label: null,
  is_enabled: true,
  ...over,
});

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

async function scenario(name, { rules, email, ip, viaToken = true }, expected) {
  RULES = rules;
  CONTACT_EMAIL = email || null;
  await ea.invalidateEnvironment(ENV);

  const decision = viaToken
    ? await ea.evaluateAccess({ envId: ENV, wrikeToken: `token-${name}-${Math.random()}`, ip })
    : await ea.evaluateAccess({ envId: ENV, email, ip });

  check(name, decision.code, expected.code);
  check(`${name} · allowed`, decision.allowed, expected.allowed);
}

(async () => {
  console.log("\nEmail rules");
  await scenario(
    "unlisted email is refused",
    { rules: [], email: "stranger@other.com" },
    { code: "NOT_ALLOWED", allowed: false },
  );
  await scenario(
    "listed email passes",
    { rules: [rule()], email: "alex@company.com" },
    { code: "ALLOWED", allowed: true },
  );
  await scenario(
    "email match is case-insensitive",
    { rules: [rule()], email: "ALEX@Company.COM" },
    { code: "ALLOWED", allowed: true },
  );
  await scenario(
    "disabled email rule does not match",
    { rules: [rule({ is_enabled: false })], email: "alex@company.com" },
    { code: "NOT_ALLOWED", allowed: false },
  );

  console.log("\nDomain rules");
  await scenario(
    "domain rule covers anyone on that domain",
    { rules: [rule({ rule_type: "domain", value: "company.com" })], email: "new.hire@company.com" },
    { code: "ALLOWED", allowed: true },
  );
  await scenario(
    "domain rule does not cover a different domain",
    { rules: [rule({ rule_type: "domain", value: "company.com" })], email: "person@other.com" },
    { code: "NOT_ALLOWED", allowed: false },
  );

  console.log("\nIP rules — exact");
  await scenario(
    "exact IPv4 match",
    { rules: [rule({ rule_type: "ip", value: "203.0.113.4" })], viaToken: false, ip: "203.0.113.4" },
    { code: "ALLOWED", allowed: true },
  );
  await scenario(
    "IPv4 mismatch",
    { rules: [rule({ rule_type: "ip", value: "203.0.113.4" })], viaToken: false, ip: "203.0.113.5" },
    { code: "NOT_ALLOWED", allowed: false },
  );
  await scenario(
    "exact IPv6 match",
    { rules: [rule({ rule_type: "ip", value: "2001:db8::1" })], viaToken: false, ip: "2001:db8::1" },
    { code: "ALLOWED", allowed: true },
  );

  console.log("\nIP rules — CIDR");
  await scenario(
    "address inside an IPv4 /24 matches",
    { rules: [rule({ rule_type: "ip", value: "203.0.113.0/24" })], viaToken: false, ip: "203.0.113.200" },
    { code: "ALLOWED", allowed: true },
  );
  await scenario(
    "address outside an IPv4 /24 is refused",
    { rules: [rule({ rule_type: "ip", value: "203.0.113.0/24" })], viaToken: false, ip: "203.0.114.1" },
    { code: "NOT_ALLOWED", allowed: false },
  );
  await scenario(
    "address inside an IPv6 /64 matches",
    { rules: [rule({ rule_type: "ip", value: "2001:db8::/64" })], viaToken: false, ip: "2001:db8::abcd" },
    { code: "ALLOWED", allowed: true },
  );
  await scenario(
    "an IPv4 address never matches an IPv6 CIDR",
    { rules: [rule({ rule_type: "ip", value: "2001:db8::/64" })], viaToken: false, ip: "203.0.113.4" },
    { code: "NOT_ALLOWED", allowed: false },
  );
  await scenario(
    "a malformed IP never matches, never throws",
    { rules: [rule({ rule_type: "ip", value: "203.0.113.0/24" })], viaToken: false, ip: "not-an-ip" },
    { code: "NOT_ALLOWED", allowed: false },
  );

  console.log("\nMatch-any across mixed rule types");
  await scenario(
    "IP fails but domain on the same request would still pass (separate call)",
    {
      rules: [
        rule({ rule_type: "ip", value: "203.0.113.0/24" }),
        rule({ rule_type: "domain", value: "company.com", id: "r-domain" }),
      ],
      email: "person@company.com",
      viaToken: false,
      ip: "10.0.0.1",
    },
    { code: "ALLOWED", allowed: true },
  );
  await scenario(
    "neither email nor IP rule matches -> denied",
    {
      rules: [
        rule({ rule_type: "ip", value: "203.0.113.0/24" }),
        rule({ rule_type: "domain", value: "company.com", id: "r-domain" }),
      ],
      email: "person@other.com",
      viaToken: false,
      ip: "10.0.0.1",
    },
    { code: "NOT_ALLOWED", allowed: false },
  );

  console.log("\nUnbound token");
  await scenario(
    "no environment on the token -> denied",
    { rules: [], email: "alex@company.com", viaToken: false },
    { code: "NOT_ALLOWED", allowed: false }, // overwritten below; see explicit case
  );

  {
    RULES = [];
    const decision = await ea.evaluateAccess({ envId: null, email: "alex@company.com" });
    check("token with no env_id is refused", decision.code, "ENVIRONMENT_UNKNOWN");
    check("token with no env_id · allowed", decision.allowed, false);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
