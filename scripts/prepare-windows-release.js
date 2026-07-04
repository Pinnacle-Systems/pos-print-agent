"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const AGENT_NAME = "Pinnacle POS Print Agent";

const ROOT_DIR = path.resolve(__dirname, "..");
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, "package.json");
const DEPLOYMENT_DIR = path.join(ROOT_DIR, "deployment", "windows-service");
const SETUP_UI_SRC_DIR = path.join(ROOT_DIR, "src", "setup-ui");
const RELEASE_DIR = path.join(ROOT_DIR, "release", "PosPrintAgent");
const EXE_PATH = path.join(RELEASE_DIR, "PosPrintAgent.exe");
const WINSW_EXE_PATH = path.join(RELEASE_DIR, "PosPrintAgentService.exe");
const SETUP_UI_DEST_DIR = path.join(RELEASE_DIR, "setup-ui");
const SUMATRA_EXE_NAME = "SumatraPDF.exe";
const SUMATRA_SRC_PATH = path.join(ROOT_DIR, "tools", SUMATRA_EXE_NAME);
const SUMATRA_DEST_PATH = path.join(RELEASE_DIR, SUMATRA_EXE_NAME);
const DIST_BUILD_INFO_PATH = path.join(ROOT_DIR, "dist", "build-info.json");
const BUILD_INFO_DEST_PATH = path.join(RELEASE_DIR, "build-info.json");
const SMOKE_TEST_SRC_PATH = path.join(ROOT_DIR, "scripts", "smoke-test-local.ps1");
const SMOKE_TEST_DEST_PATH = path.join(RELEASE_DIR, "smoke-test-local.ps1");
const RELEASE_MANIFEST_PATH = path.join(RELEASE_DIR, "release-manifest.json");

const SERVICE_FILES = [
  "PosPrintAgentService.xml",
  "install-service.bat",
  "uninstall-service.bat",
  "start-service.bat",
  "stop-service.bat",
  "backup-config.ps1",
];

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

// dist/build-info.json is written by scripts/generate-build-info.js as part
// of `npm run build` (see src/version-info.ts for how GET /health and
// GET /version read it). Copying it beside the exe follows the same
// "generated file lives next to PosPrintAgent.exe, not inside the pkg
// snapshot" pattern as the setup-ui assets above.
function copyBuildInfoIfPresent() {
  if (!fs.existsSync(DIST_BUILD_INFO_PATH)) {
    return false;
  }
  fs.copyFileSync(DIST_BUILD_INFO_PATH, BUILD_INFO_DEST_PATH);
  console.log("Copied build-info.json");
  return true;
}

// Both are authored in this repo (not third-party binaries), so unlike
// SumatraPDF a missing source file here is this project's own bug, not
// something a support person needs to go obtain - fail loudly.
function copySupportScripts() {
  if (!fs.existsSync(SMOKE_TEST_SRC_PATH)) {
    throw new Error(`Missing expected script: ${SMOKE_TEST_SRC_PATH}`);
  }
  fs.copyFileSync(SMOKE_TEST_SRC_PATH, SMOKE_TEST_DEST_PATH);
  console.log("Copied smoke-test-local.ps1");
}

function readAgentVersion() {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf-8"));
  return packageJson.version;
}

function readBuildTime() {
  if (fs.existsSync(DIST_BUILD_INFO_PATH)) {
    try {
      const buildInfo = JSON.parse(fs.readFileSync(DIST_BUILD_INFO_PATH, "utf-8"));
      if (typeof buildInfo.buildTime === "string") {
        return buildInfo.buildTime;
      }
    } catch {
      // Fall through to the timestamp fallback below.
    }
  }
  return new Date().toISOString();
}

function listFilesRecursive(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// Generated last, after every other file in the release folder has been
// copied/written, so the manifest actually covers everything a support
// person receives - including README.md and the support scripts - not just
// the binaries. Excludes itself, obviously (it doesn't exist yet when the
// file list is built).
function writeReleaseManifest(version, buildTime) {
  const files = listFilesRecursive(RELEASE_DIR)
    .filter((filePath) => filePath !== RELEASE_MANIFEST_PATH)
    .map((filePath) => {
      const relativePath = path.relative(RELEASE_DIR, filePath).split(path.sep).join("/");
      const stats = fs.statSync(filePath);
      return { path: relativePath, sizeBytes: stats.size, sha256: sha256File(filePath) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const manifest = { agentName: AGENT_NAME, version, buildTime, files };
  fs.writeFileSync(RELEASE_MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`Wrote release-manifest.json (${files.length} file(s))`);
}

function buildReleaseReadme() {
  return `# ${AGENT_NAME} - Install Guide

This folder is a ready-to-deploy copy of the POS Print Agent for a single
POS counter. Node.js does not need to be installed on this machine, and
you do not need to run \`npm install\` here - everything required is
already in this folder.

## What this agent does

This is a small local Windows service that runs on this one counter
machine and exposes a \`127.0.0.1\`-only HTTP API (nothing outside this
machine can reach it). It receives generic print jobs from the web POS
(receipt text/layout instructions, barcode-label instructions, or a
finished A4 invoice PDF) and sends the right bytes to whichever physical
printer is mapped to that job's role *on this specific counter*. It does
not decide receipt/label/invoice content or layout - that is entirely the
web POS's job; this agent only knows local printer names and how to talk
to them.

See \`release-manifest.json\` in this folder for the exact file list,
sizes, and SHA256 checksums of everything shipped in this release.

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
\`PDF_PRINT_TOOL_NOT_FOUND\`. Receipt and barcode-label printing (ESC/POS,
TSPL) do not need it.

## 4. Install the service

Right-click \`install-service.bat\` and choose **Run as administrator**.
It creates the required \`C:\\ProgramData\\Pinnacle\\PosPrintAgent\` folders
(config/logs/temp) if missing, registers the Windows service, sets it to
start automatically on boot, and starts it immediately. It will print a
clear error (not a cryptic Windows message) if it isn't run as
Administrator, or if \`PosPrintAgent.exe\`/\`PosPrintAgentService.exe\` are
missing from this folder.

## 5. Verify it is running

On the same machine, open in a browser (or run \`smoke-test-local.ps1\` -
see below):

\`\`\`text
http://127.0.0.1:17777/health
\`\`\`

You should see \`"status": "ok"\`. This also reports the agent version,
which printer roles are configured, and whether each mapped printer is
still installed on this machine (\`printerInstalled\`).

## 6. Open the setup page

\`\`\`text
http://127.0.0.1:17777/setup
\`\`\`

Use this to configure printer mappings for this counter - see the next
three sections.

### Configuring the receipt printer

On the setup page, under **Receipt Printer**: pick the Windows printer
this counter's receipt/thermal printer is installed as, choose a paper
width (58mm/80mm), leave the printer language as \`ESC/POS\` (the only
implemented option), and click **Save Configuration**. Use **Test Receipt
Print** to confirm the agent can reach it.

### Configuring the barcode label printer

Under **Barcode Label Printer**: pick the Windows printer this counter's
label printer is installed as, optionally fill in the label width/height
in mm (informational, matches what POS/backend sends per print job),
leave the printer language as \`TSPL\` (the only implemented option), and
save. Use **Test Barcode Print** to confirm connectivity.

### Configuring the A4 invoice printer

Under **A4 Invoice Printer**: pick the Windows printer for A4 paper (a
normal office/laser printer, not the receipt printer), leave the printer
language as \`PDF\`, and save. Remember step 3 above - this role needs
\`SumatraPDF.exe\` present in this folder. Use **Test A4 Print** to confirm
connectivity.

Cash drawer is not a separate printer role yet - it is triggered as part
of a receipt print job via the \`openDrawer\` instruction (see the setup
page's Cash Drawer section and the root project README).

## 7. Run the local smoke test

\`smoke-test-local.ps1\` (in this folder) is a PowerShell-only script (no
Node.js required) that checks \`/health\`, \`/version\`, \`/printers\`,
\`/config\`, and sends a test receipt print if one is configured:

\`\`\`powershell
powershell -ExecutionPolicy Bypass -File smoke-test-local.ps1
\`\`\`

It prints \`[PASS]\`/\`[WARN]\`/\`[FAIL]\` lines and exits with a non-zero
code if the agent could not be reached at all or a hard check failed -
useful for a support person to run right after installing, or any time
something seems wrong.

## Starting / stopping the service

- Stop: right-click \`stop-service.bat\` -> Run as administrator.
- Start: right-click \`start-service.bat\` -> Run as administrator.

## Upgrading the agent

1. Stop the service (\`stop-service.bat\`).
2. Back up the current config (optional but recommended - see
   \`backup-config.ps1\` below).
3. Replace \`PosPrintAgent.exe\`, \`build-info.json\`, and the \`setup-ui\`
   folder in \`C:\\Pinnacle\\PosPrintAgent\` with the new release's copies
   (everything under \`C:\\Pinnacle\\PosPrintAgent\` except your
   \`SumatraPDF.exe\`, which does not need to change - it isn't built by
   this project and doesn't change between releases).
4. Start the service again (\`start-service.bat\`).
5. Open \`http://127.0.0.1:17777/health\` and confirm \`"status": "ok"\`
   and the expected \`version\`.
6. Run \`smoke-test-local.ps1\` to confirm everything still works.

Printer mappings and other settings under
\`C:\\ProgramData\\Pinnacle\\PosPrintAgent\` are not affected by an upgrade -
do not delete that folder unless you intentionally want to reset this
counter's printer configuration.

## Backing up the printer configuration

\`backup-config.ps1\` (in this folder) copies the current \`config.json\` to
a timestamped file under
\`C:\\ProgramData\\Pinnacle\\PosPrintAgent\\backups\\\`:

\`\`\`powershell
powershell -ExecutionPolicy Bypass -File backup-config.ps1
\`\`\`

Safe to run any time, including while the service is running.

## Uninstalling

Right-click \`uninstall-service.bat\` -> Run as administrator. This removes
the Windows service but keeps the config and logs listed below.

## Where things are stored

- Config: \`C:\\ProgramData\\Pinnacle\\PosPrintAgent\\config.json\`
- Config backups: \`C:\\ProgramData\\Pinnacle\\PosPrintAgent\\backups\`
- Logs:   \`C:\\ProgramData\\Pinnacle\\PosPrintAgent\\logs\\agent.log\`
- Temp PDF files (deleted automatically after each print job): \`C:\\ProgramData\\Pinnacle\\PosPrintAgent\\temp\`

These survive both upgrades and uninstalls. Logs only ever contain
metadata (job IDs, printer names, byte counts, success/failure) - never
receipt/label text, barcode/QR values, or PDF content.

## Troubleshooting

### /health does not open

The service likely isn't running. Check \`services.msc\` for "Pinnacle POS
Print Agent", or re-run \`install-service.bat\` / \`start-service.bat\` as
Administrator. If it still doesn't respond, check
\`C:\\ProgramData\\Pinnacle\\PosPrintAgent\\logs\\agent.log\` and the Windows
Event Viewer (Application log) for a crash on startup.

### Service does not start

Check \`C:\\ProgramData\\Pinnacle\\PosPrintAgent\\logs\\agent.log\` and the
Windows Event Viewer (Application log). Common causes: port 17777 already
in use by something else, or \`PosPrintAgent.exe\` missing/corrupted in
this folder.

### Printer not listed on the setup page

Click **Refresh Printer List** on the setup page (or \`GET /printers\`).
If it's still missing, confirm the printer is installed in Windows
**for the account the service runs as** (see next item) - not just for
whichever user is logged in interactively.

### Printer mapping says \`printerInstalled: false\` (or the setup page shows "not currently installed")

The printer name saved in \`config.json\` no longer matches an installed
Windows printer - it may have been renamed, reinstalled, or removed. The
Windows service also runs as its own account (typically \`LocalSystem\`),
which needs its own access to the printer; a printer visible to your
interactive login is not automatically visible to the service. Reselect
the printer on the setup page (after **Refresh Printer List**) and save.

### Receipt print does not cut

Confirm the printer actually supports the ESC/POS full/partial cut command
and that its auto-cutter is enabled/not jammed. The agent always adds a
small safety feed before cutting (see the root project README's ESC/POS
rendering notes) - if paper is still being cut into printed text, that's a
printer-specific cut-position issue, not something to work around here.

### Drawer does not open

\`openDrawer\` sends a fixed, conservative ESC/POS kick pulse - whether a
drawer physically opens depends on it being wired into that printer's
kick-cable port and accepting that pulse timing. Confirm the drawer cable
is connected to the receipt printer (not directly to the PC), and that a
receipt job actually included the \`openDrawer\` instruction (the agent
never opens the drawer on its own).

### Barcode label does not print correctly

TSPL command support and conventions vary across label printer models.
Confirm the label size (\`labelWidthMm\`/\`labelHeightMm\`/\`gapMm\`) in the
print request matches the physical labels loaded, and that the printer's
gap/black-mark sensor is calibrated (usually a printer-panel or driver
utility function, not something this agent controls). If unsure whether
the agent is sending correct command bytes, redirect the printer to a
file (see the root project README's "Testing barcode-label printing with
a Generic / Text Only printer mapped to a file") and inspect the raw TSPL
text.

### PDF_PRINT_TOOL_NOT_FOUND

\`SumatraPDF.exe\` was not found. Confirm it is literally in this folder
(\`C:\\Pinnacle\\PosPrintAgent\\SumatraPDF.exe\`), next to
\`PosPrintAgent.exe\`. This project does not download or bundle it
automatically - see step 3 above.

### PDF prints only in interactive/user mode, not when run as a service

The Windows service runs as its own account (typically \`LocalSystem\`),
which needs its own access to both the target printer and to running
\`SumatraPDF.exe\` - it does not inherit anything from an interactively
logged-in user session. If PDF printing works when you run the agent
manually (\`npm run dev\` / \`node dist/main.js\` in an interactive login)
but not as the installed service, this is almost always a Windows
printer-permissions issue for the service account, not a bug in this
agent: grant that account access to the printer, or reconfigure
\`PosPrintAgentService.xml\` to run the service as a different account
that already has that access.
`;
}

function writeReleaseReadme() {
  fs.writeFileSync(path.join(RELEASE_DIR, "README.md"), buildReleaseReadme(), "utf8");
  console.log("Wrote README.md");
}

function main() {
  ensureReleaseDir();
  copyServiceFiles();
  copySetupUiAssets();
  copySupportScripts();
  const hasSumatra = copySumatraPdfIfPresent() || fs.existsSync(SUMATRA_DEST_PATH);
  const hasBuildInfo = copyBuildInfoIfPresent() || fs.existsSync(BUILD_INFO_DEST_PATH);
  writeReleaseReadme();

  const version = readAgentVersion();
  const buildTime = readBuildTime();
  writeReleaseManifest(version, buildTime);

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

  if (!hasBuildInfo) {
    console.log("WARNING: build-info.json is missing (dist/build-info.json not found).");
    console.log("  Run `npm run build` (or `npm run package:win`) first so GET /health and");
    console.log("  GET /version report a real version/buildTime instead of a fallback.");
    console.log("");
  }

  console.log("Next steps:");
  console.log("  1. Copy release/PosPrintAgent to C:\\Pinnacle\\PosPrintAgent on the counter machine");
  console.log("  2. Ensure PosPrintAgentService.exe (WinSW) is present in that folder");
  console.log("  3. Run install-service.bat as Administrator");
  console.log("  4. Verify http://127.0.0.1:17777/health, then run smoke-test-local.ps1");
}

main();
