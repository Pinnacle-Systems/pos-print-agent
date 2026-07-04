"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, "package.json");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const BUILD_INFO_PATH = path.join(DIST_DIR, "build-info.json");

// Generates dist/build-info.json - read at runtime by src/version-info.ts
// (GET /health and GET /version) so the reported version/buildTime always
// reflect what was actually built, not a hardcoded string that drifts out
// of sync with package.json.
function main() {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf-8"));
  const buildInfo = {
    version: packageJson.version,
    buildTime: new Date().toISOString(),
  };

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(BUILD_INFO_PATH, JSON.stringify(buildInfo, null, 2), "utf-8");
  console.log(`Wrote build-info.json (version ${buildInfo.version}, buildTime ${buildInfo.buildTime})`);
}

main();
