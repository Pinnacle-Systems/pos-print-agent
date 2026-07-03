"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEPLOYMENT_DIR = path.join(ROOT_DIR, "deployment", "windows-service");
const RELEASE_DIR = path.join(ROOT_DIR, "release", "PosPrintAgent");
const EXE_PATH = path.join(RELEASE_DIR, "PosPrintAgent.exe");
const WINSW_EXE_PATH = path.join(RELEASE_DIR, "PosPrintAgentService.exe");

const SERVICE_FILES = [
  "PosPrintAgentService.xml",
  "install-service.bat",
  "uninstall-service.bat",
  "start-service.bat",
  "stop-service.bat",
];

// Static/setup assets are optional today (the agent has no bundled UI yet),
// but if a future `/setup` page ships static files from one of these
// folders, this copies them into the release folder automatically.
const OPTIONAL_ASSET_DIRS = ["public", "static"];

const RELEASE_README = `# Pinnacle POS Print Agent - Install Guide

This folder is a ready-to-deploy copy of the POS Print Agent for a single
POS counter. Node.js does not need to be installed on this machine, and
you do not need to run \`npm install\` here - everything required is
already in this folder.

## 1. Copy this folder

Copy this entire folder to:

\`\`\`text
C:\\Pinnacle\\PosPrintAgent
\`\`\`

## 2. Make sure the service wrapper is present

This folder must contain \`PosPrintAgentService.exe\` (WinSW) next to
\`PosPrintAgentService.xml\`. If it is missing, download it from
https://github.com/winsw/winsw/releases and rename it to
\`PosPrintAgentService.exe\`.

## 3. Install the service

Right-click \`install-service.bat\` and choose **Run as administrator**.

## 4. Verify it is running

On the same machine, open in a browser:

\`\`\`text
http://127.0.0.1:17777/health
\`\`\`

You should see \`"status": "ok"\` in the response.

## 5. Open the setup page

\`\`\`text
http://127.0.0.1:17777/setup
\`\`\`

Use this to configure printer mappings for this counter.

## Starting / stopping the service

- Stop: right-click \`stop-service.bat\` -> Run as administrator.
- Start: right-click \`start-service.bat\` -> Run as administrator.

## Upgrading the agent

1. Stop the service (\`stop-service.bat\`).
2. Replace \`PosPrintAgent.exe\` in this folder with the new build.
3. Start the service again (\`start-service.bat\`).

Printer mappings and other settings are not affected by an upgrade.

## Where things are stored

- Config: \`C:\\ProgramData\\Pinnacle\\PosPrintAgent\\config.json\`
- Logs:   \`C:\\ProgramData\\Pinnacle\\PosPrintAgent\\logs\`

These survive both upgrades and uninstalls.

## Uninstalling

Right-click \`uninstall-service.bat\` -> Run as administrator. This removes
the Windows service but keeps the config and logs listed above.
`;

function ensureReleaseDir() {
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
}

function copyServiceFiles() {
  for (const file of SERVICE_FILES) {
    const src = path.join(DEPLOYMENT_DIR, file);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing expected deployment file: ${src}`);
    }
    fs.copyFileSync(src, path.join(RELEASE_DIR, file));
    console.log(`Copied ${file}`);
  }
}

function copyOptionalAssets() {
  for (const dir of OPTIONAL_ASSET_DIRS) {
    const src = path.join(ROOT_DIR, dir);
    if (fs.existsSync(src)) {
      fs.cpSync(src, path.join(RELEASE_DIR, dir), { recursive: true });
      console.log(`Copied static assets from ${dir}/`);
    }
  }
}

function writeReleaseReadme() {
  fs.writeFileSync(path.join(RELEASE_DIR, "README.md"), RELEASE_README, "utf8");
  console.log("Wrote README.md");
}

function main() {
  ensureReleaseDir();
  copyServiceFiles();
  copyOptionalAssets();
  writeReleaseReadme();

  const hasExe = fs.existsSync(EXE_PATH);
  const hasWinsw = fs.existsSync(WINSW_EXE_PATH);

  console.log("");
  console.log(`Release folder prepared at: ${RELEASE_DIR}`);
  console.log("");

  if (!hasExe) {
    console.log("WARNING: PosPrintAgent.exe is missing from the release folder.");
    console.log("  Run `npm run package:win` to build it.");
    console.log("");
  }

  if (!hasWinsw) {
    console.log("WARNING: PosPrintAgentService.exe (WinSW) is missing from the release folder.");
    console.log("  Download it from https://github.com/winsw/winsw/releases,");
    console.log(`  rename it to PosPrintAgentService.exe, and place it in ${RELEASE_DIR}`);
    console.log("");
  }

  console.log("Next steps:");
  console.log("  1. Copy release/PosPrintAgent to C:\\Pinnacle\\PosPrintAgent on the counter machine");
  console.log("  2. Ensure PosPrintAgentService.exe (WinSW) is present in that folder");
  console.log("  3. Run install-service.bat as Administrator");
  console.log("  4. Verify http://127.0.0.1:17777/health");
}

main();
