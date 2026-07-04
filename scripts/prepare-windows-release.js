"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEPLOYMENT_DIR = path.join(ROOT_DIR, "deployment", "windows-service");
const SETUP_UI_SRC_DIR = path.join(ROOT_DIR, "src", "setup-ui");
const RELEASE_DIR = path.join(ROOT_DIR, "release", "PosPrintAgent");
const EXE_PATH = path.join(RELEASE_DIR, "PosPrintAgent.exe");
const WINSW_EXE_PATH = path.join(RELEASE_DIR, "PosPrintAgentService.exe");
const SETUP_UI_DEST_DIR = path.join(RELEASE_DIR, "setup-ui");
const SUMATRA_EXE_NAME = "SumatraPDF.exe";
const SUMATRA_SRC_PATH = path.join(ROOT_DIR, "tools", SUMATRA_EXE_NAME);
const SUMATRA_DEST_PATH = path.join(RELEASE_DIR, SUMATRA_EXE_NAME);

const SERVICE_FILES = [
  "PosPrintAgentService.xml",
  "install-service.bat",
  "uninstall-service.bat",
  "start-service.bat",
  "stop-service.bat",
];

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

## 3. Make sure the PDF print tool is present (for A4 invoice printing)

If this counter prints PDF invoices (\`POST /print\` with \`payloadType:
"PDF"\`), this folder must also contain \`SumatraPDF.exe\` next to
\`PosPrintAgent.exe\`. Without it, PDF print jobs fail with
\`PDF_PRINT_TOOL_NOT_FOUND\`. Receipt printing (ESC/POS) does not need it.

## 4. Install the service

Right-click \`install-service.bat\` and choose **Run as administrator**.

## 5. Verify it is running

On the same machine, open in a browser:

\`\`\`text
http://127.0.0.1:17777/health
\`\`\`

You should see \`"status": "ok"\` in the response.

## 6. Open the setup page

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
3. Replace the \`setup-ui\` folder with the new one (it holds the setup
   page's HTML/CSS/JS and must sit next to \`PosPrintAgent.exe\`).
4. Start the service again (\`start-service.bat\`).

\`SumatraPDF.exe\` does not need to change for an agent upgrade - it isn't
built by this project and doesn't change between releases.

Printer mappings and other settings are not affected by an upgrade.

## Where things are stored

- Config: \`C:\\ProgramData\\Pinnacle\\PosPrintAgent\\config.json\`
- Logs:   \`C:\\ProgramData\\Pinnacle\\PosPrintAgent\\logs\`
- Temp PDF files (deleted automatically after each print job): \`C:\\ProgramData\\Pinnacle\\PosPrintAgent\\temp\`

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

// The setup page (GET /setup) is served from plain static files rather than
// bundled into the pkg snapshot. pkg's virtual snapshot filesystem is not a
// reliable place to serve static assets from, so instead these files are
// copied beside PosPrintAgent.exe and read from real disk at runtime (see
// resolveSetupUiDir() in src/routes/setup.routes.ts).
function copySetupUiAssets() {
  if (!fs.existsSync(SETUP_UI_SRC_DIR)) {
    throw new Error(`Missing setup UI source directory: ${SETUP_UI_SRC_DIR}`);
  }
  fs.cpSync(SETUP_UI_SRC_DIR, SETUP_UI_DEST_DIR, { recursive: true });
  console.log("Copied setup UI assets to setup-ui/");
}

// SumatraPDF.exe is a third-party binary, not something this project builds
// or is allowed to fetch automatically (see README "SumatraPDF requirement").
// If a copy has been placed at tools/SumatraPDF.exe (a one-time manual step
// per dev machine / CI image), copy it into the release folder so PDF
// printing works out of the box; otherwise warn loudly rather than silently
// shipping a release that can't print PDFs.
function copySumatraPdfIfPresent() {
  if (!fs.existsSync(SUMATRA_SRC_PATH)) {
    return false;
  }
  fs.copyFileSync(SUMATRA_SRC_PATH, SUMATRA_DEST_PATH);
  console.log(`Copied ${SUMATRA_EXE_NAME}`);
  return true;
}

function writeReleaseReadme() {
  fs.writeFileSync(path.join(RELEASE_DIR, "README.md"), RELEASE_README, "utf8");
  console.log("Wrote README.md");
}

function main() {
  ensureReleaseDir();
  copyServiceFiles();
  copySetupUiAssets();
  const hasSumatra = copySumatraPdfIfPresent() || fs.existsSync(SUMATRA_DEST_PATH);
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

  if (!hasSumatra) {
    console.log("WARNING: SumatraPDF.exe is missing from the release folder.");
    console.log("  PDF printing (POST /print with payloadType \"PDF\") will fail with");
    console.log("  PDF_PRINT_TOOL_NOT_FOUND until it is added.");
    console.log(`  Place a copy at ${SUMATRA_SRC_PATH} and re-run this script,`);
    console.log(`  or copy it directly into ${RELEASE_DIR} yourself.`);
    console.log("");
  }

  console.log("Next steps:");
  console.log("  1. Copy release/PosPrintAgent to C:\\Pinnacle\\PosPrintAgent on the counter machine");
  console.log("  2. Ensure PosPrintAgentService.exe (WinSW) is present in that folder");
  console.log("  3. Run install-service.bat as Administrator");
  console.log("  4. Verify http://127.0.0.1:17777/health");
}

main();
