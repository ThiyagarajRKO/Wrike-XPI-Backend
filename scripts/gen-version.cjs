"use strict";

/**
 * Writes dist/version.json for the running server to read at startup
 * (see src/utils/version.js). Runs at the end of `npm run build`, after
 * `dist/` has been created by babel.
 *
 * Deployment is git-clone + `npm run build` on the host, so `git rev-parse`
 * is the normal source. GIT_COMMIT / GIT_BRANCH env vars override it when
 * set (e.g. a future pipeline), and "unknown" is the last resort so a build
 * without a working git checkout still succeeds.
 */

const { execSync } = require("child_process");
const { writeFileSync, mkdirSync } = require("fs");
const path = require("path");

const pkg = require("../package.json");

const git = (args) => {
  try {
    return execSync(`git ${args}`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
};

const info = {
  version: pkg.version,
  commit: process.env.GIT_COMMIT || git("rev-parse --short HEAD") || "unknown",
  branch:
    process.env.GIT_BRANCH || git("rev-parse --abbrev-ref HEAD") || "unknown",
  buildTime: new Date().toISOString(),
};

const outDir = path.join(__dirname, "..", "dist");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, "version.json"),
  JSON.stringify(info, null, 2) + "\n",
);

console.log(
  `version.json  v${info.version}  ${info.commit}  ${info.branch}  ${info.buildTime}`,
);
