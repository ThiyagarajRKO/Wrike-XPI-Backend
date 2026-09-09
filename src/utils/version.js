"use strict";

import { execSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";

/**
 * Build identity for the running server.
 *
 * In production this is read once from dist/version.json, written by
 * scripts/gen-version.cjs at the end of `npm run build`. In dev
 * (`npm run dev`, which has no build step) it is derived live from
 * package.json + git instead.
 *
 * `version` is the user-facing string shown in the app UI (the root
 * package.json `version`). `commit` / `branch` / `buildTime` are extra
 * detail for GET /version, GET /health and the UI tooltip.
 */

let cached = null;

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const tryGit = (args) => {
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

export const getBuildInfo = () => {
  if (cached) return cached;

  const root = process.cwd();

  // 1. Production: the file baked by the build.
  try {
    const fromFile = readJson(path.join(root, "dist", "version.json"));
    if (fromFile && fromFile.version) {
      cached = fromFile;
      return cached;
    }
  } catch {
    // Not built yet (dev) or unreadable — fall through to the live derivation.
  }

  // 2. Dev fallback: package.json version + live git.
  let version = "0.0.0";
  try {
    version = readJson(path.join(root, "package.json")).version || version;
  } catch {
    // keep the default
  }

  cached = {
    version,
    commit: tryGit("rev-parse --short HEAD") || "dev",
    branch: tryGit("rev-parse --abbrev-ref HEAD") || "dev",
    buildTime: null,
  };
  return cached;
};
