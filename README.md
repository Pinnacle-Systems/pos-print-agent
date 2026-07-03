# Pinnacle POS Print Agent

A local Windows service that runs on each POS counter machine and exposes a
`127.0.0.1`-only HTTP API for printing receipts, printing barcode labels, and
opening cash drawers.

## Why printer configuration is machine-level

Every POS counter has its own set of physical printers (receipt printer,
label printer, cash drawer) wired into that specific machine. That mapping
is a fact about the machine, not about the web POS application or any user
account, so it does not belong in the web backend or in a user profile.

Instead:

- The **web POS** only knows about logical print roles: `receipt`,
  `barcode-label`, `a4-invoice`, `cash-drawer`.
- The **local agent** (this project) runs on the counter machine and owns a
  config file that maps each logical role to an actual Windows printer name
  installed on that machine.
- The web POS calls this agent over `localhost` and never needs to know
  which physical printer is attached.

This keeps the web backend free of machine-specific details and lets each
counter be reconfigured (e.g. printer replaced) without touching the web
application.

This service is designed to be installed as a Windows service via
[WinSW](https://github.com/winsw/winsw), one instance per POS counter.

## Requirements

- Node.js 18+
- Windows (config/log paths are Windows-specific; `machineName` uses the
  Windows hostname)

## Install dependencies

```bash
npm install
```

## Run in development

```bash
npm run dev
```

This starts the agent on `http://127.0.0.1:17777` using `tsx` (no build
step required). On first run it creates the config file and log directory
under `C:\ProgramData\Pinnacle\PosPrintAgent` if they don't already exist.

## Build

```bash
npm run build
```

Compiles TypeScript from `src/` to `dist/` using `tsc`.

```bash
npm start
```

Runs the compiled agent from `dist/main.js`. This is the entry point that
should eventually be wrapped by WinSW to run as a Windows service.

Other scripts:

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest
```

## Calling /health

Once running, verify the agent is alive:

```bash
curl http://127.0.0.1:17777/health
```

Example response:

```json
{
  "status": "ok",
  "agentName": "Pinnacle POS Print Agent",
  "version": "1.0.0",
  "machineName": "COUNTER-01",
  "configured": true,
  "printerMappings": {
    "receipt": {
      "configured": true,
      "printerName": "EPSON TM-T82X Receipt"
    },
    "barcode-label": {
      "configured": false
    },
    "a4-invoice": {
      "configured": false
    },
    "cash-drawer": {
      "configured": false
    }
  }
}
```

Top-level `configured` is `true` only once the machine has a non-empty
`machineCode` and at least one entry in `printerMappings`. The
`printerMappings` object always lists all four
[supported print roles](#supported-print-roles), each with its own
`configured` flag, so a caller can tell at a glance which roles still need
setup on this counter.

## Where config is stored

```text
C:\ProgramData\Pinnacle\PosPrintAgent\config.json
```

A default config is created automatically on first run if the file does not
exist:

```json
{
  "agentPort": 17777,
  "machineCode": "",
  "allowedOrigins": [
    "http://localhost:5173",
    "https://pos.yourdomain.com"
  ],
  "printerMappings": {}
}
```

`config.json` is validated against a Zod schema (`src/config/config.schema.ts`)
on every load, so a malformed file will fail fast with a clear error instead
of silently starting with bad data.

The config lives under `ProgramData` (machine-wide), not next to the
executable, so it survives reinstalls/upgrades of the agent binary and is
consistent regardless of where the executable is deployed on disk.

## Where logs are stored

```text
C:\ProgramData\Pinnacle\PosPrintAgent\logs\agent.log
```

The log directory is created automatically on startup. Logging failures are
swallowed so a full disk or permissions issue never crashes the agent.

## Printer discovery and printer mappings

The agent discovers printers installed on the local Windows machine and
lets you map each [print role](#supported-print-roles) to one of them.
Discovery and mapping are separate steps:

1. **Discovery** (`GET /printers`) asks Windows what printers are
   installed right now. The agent never guesses or caches this list
   beyond the lifetime of a single request — reprinting the endpoint
   always reflects whatever is currently installed.
2. **Mapping** (`POST /config/printer-mappings`) is how you tell the
   agent "use *this* installed printer whenever something needs to print
   a receipt / barcode label / A4 invoice / open the cash drawer". This
   is the machine-level mapping described above: it lives in this
   counter's `config.json`, never in the web POS.

Discovery is wrapped behind
[`src/printers/printer-discovery.service.ts`](src/printers/printer-discovery.service.ts)
so routes and the config service never talk to Windows directly. On
Windows it shells out to `powershell.exe` to query the `Win32_Printer`
WMI class (no native npm addon, so it isn't affected by exe packaging or
native module rebuilds). On a non-Windows dev machine it transparently
falls back to a small list of mock printers so `/printers` and mapping
validation still work locally. If the underlying PowerShell call fails,
`GET /printers` responds with a structured `502 PRINTER_DISCOVERY_FAILED`
error instead of crashing the agent.

### Supported print roles

```text
receipt
barcode-label
a4-invoice
cash-drawer
```

### Supported command languages

```text
ESC_POS
TSPL
ZPL
PDF
WINDOWS_DRIVER
```

Not every command language makes sense for every role. Each mapping is
validated against this table:

| Print role      | Allowed command languages       |
| --------------- | ------------------------------- |
| `receipt`       | `ESC_POS`, `WINDOWS_DRIVER`     |
| `barcode-label` | `TSPL`, `ZPL`, `WINDOWS_DRIVER` |
| `a4-invoice`    | `PDF`, `WINDOWS_DRIVER`         |
| `cash-drawer`   | `ESC_POS`                       |

### GET /printers

Returns the printers Windows currently has installed.

```bash
curl http://127.0.0.1:17777/printers
```

```json
{
  "printers": [
    { "name": "EPSON TM-T82X Receipt", "isDefault": true },
    { "name": "TSC TE244", "isDefault": false },
    { "name": "Microsoft Print to PDF", "isDefault": false }
  ]
}
```

Use this to find the exact Windows printer name to put into a mapping —
`windowsPrinterName` must match one of these `name` values exactly.

### GET /config

Returns the full current config for this machine, including printer
mappings.

```bash
curl http://127.0.0.1:17777/config
```

```json
{
  "agentPort": 17777,
  "machineCode": "COUNTER-01",
  "allowedOrigins": [
    "http://localhost:5173",
    "https://pos.yourdomain.com"
  ],
  "printerMappings": {
    "receipt": {
      "windowsPrinterName": "EPSON TM-T82X Receipt",
      "template": "pos-receipt-80mm",
      "paperWidth": "80mm",
      "commandLanguage": "ESC_POS"
    }
  }
}
```

### POST /config/printer-mappings

Saves (replaces) the full `printerMappings` object for this machine.

```bash
curl -X POST http://127.0.0.1:17777/config/printer-mappings \
  -H "Content-Type: application/json" \
  -d '{
    "printerMappings": {
      "receipt": {
        "windowsPrinterName": "EPSON TM-T82X Receipt",
        "template": "pos-receipt-80mm",
        "paperWidth": "80mm",
        "commandLanguage": "ESC_POS"
      },
      "barcode-label": {
        "windowsPrinterName": "TSC TE244",
        "template": "barcode-label-50x25",
        "labelWidth": "50mm",
        "labelHeight": "25mm",
        "commandLanguage": "TSPL"
      }
    }
  }'
```

On success it responds with the updated full config (same shape as
`GET /config`), and the change is immediately visible to `/health` and
`/config` — no restart required.

Validation, done in
[`src/printers/printer-validation.service.ts`](src/printers/printer-validation.service.ts),
rejects the request with a structured `400` error (see shape below) if:

- a key isn't one of the [supported print roles](#supported-print-roles)
  (`INVALID_PRINT_ROLE`);
- a mapping is missing required fields or uses an unsupported
  `commandLanguage` value (`INVALID_PRINTER_MAPPING`);
- `commandLanguage` isn't allowed for that role per the table above
  (`UNSUPPORTED_COMMAND_LANGUAGE_FOR_ROLE`);
- `windowsPrinterName` doesn't match a printer currently returned by
  `GET /printers` (`PRINTER_NOT_FOUND`).

### POST /test-print

Sends a short text page to the printer currently mapped to a print role,
as a connectivity check.

```bash
curl -X POST http://127.0.0.1:17777/test-print \
  -H "Content-Type: application/json" \
  -d '{"role": "receipt"}'
```

```json
{ "success": true, "role": "receipt", "printerName": "EPSON TM-T82X Receipt" }
```

Implemented in
[`src/print-jobs/test-print.service.ts`](src/print-jobs/test-print.service.ts):
on Windows it writes a short text file and pipes it through PowerShell's
`Out-Printer -Name <printer>` (the same "shell out, no native addon"
approach as printer discovery), so it goes through the real Windows print
spooler. This confirms the agent can reach the configured printer end to
end; it is **not** raw ESC_POS/TSPL/ZPL byte printing, and it does not open
a cash drawer — those remain future work (see
[What is intentionally not implemented yet](#what-is-intentionally-not-implemented-yet)).

Errors:

- `400 INVALID_PRINT_ROLE` — `role` is missing or not one of the
  [supported print roles](#supported-print-roles).
- `400 PRINT_ROLE_NOT_CONFIGURED` — that role has no saved printer mapping
  yet; save one via `POST /config/printer-mappings` (or the setup page)
  first.
- `502 TEST_PRINT_FAILED` — the mapped printer exists in config but
  Windows/PowerShell couldn't spool a job to it (e.g. printer removed,
  offline, or a permissions issue).

### How to test printer discovery

```bash
curl http://127.0.0.1:17777/printers
```

On a real Windows machine this reflects whatever is in
**Settings → Printers & Scanners**. On a non-Windows dev machine you'll
get the built-in mock list instead, so you can still exercise mapping
validation without a Windows box.

### How to save local mappings

1. `GET /printers` to see the exact installed printer names.
2. `POST /config/printer-mappings` with one entry per role you want to
   configure, using a `windowsPrinterName` from step 1.
3. `GET /config` or `GET /health` to confirm it was saved.

You don't need to send every role at once — send whichever roles this
counter actually has printers for; unmapped roles simply show
`"configured": false`.

## Setup page

For a support person setting up a POS counter, clicking through a browser
form beats hand-writing JSON. The agent serves a small setup page for
exactly that:

```text
http://127.0.0.1:17777/setup
```

This page is served **by the local agent itself** — it is not part of the
web POS, and the web POS never links to or embeds it. It's meant to be
opened locally, once, on the counter machine, by whoever is installing or
troubleshooting that counter's printers.

### What it's for

- Shows whether the agent is healthy (`GET /health`) and this machine's
  `machineCode` (from `GET /config`).
- Lists the printers Windows currently has installed (`GET /printers`).
- Lets you pick which installed printer handles each print role — receipt,
  barcode label, A4 invoice, cash drawer — plus role-specific settings
  (receipt paper width, barcode label width/height).
- Saves your picks with one button (`POST /config/printer-mappings`) — no
  manual JSON editing.
- Warns inline if a previously-configured printer is no longer installed
  (e.g. it was unplugged or renamed in Windows).
- Has "Test Receipt/Barcode/A4/Cash Drawer" buttons wired to
  `POST /test-print`, which sends a short text page to that role's
  configured printer to confirm the agent can reach it (see
  [POST /test-print](#post-test-print) below). A role must be saved before
  it can be tested.

### Configuring the receipt printer

1. Open `http://127.0.0.1:17777/setup` on the counter machine.
2. Under **Receipt Printer**, pick the installed printer from the dropdown
   and set **Receipt Paper Width** (58mm or 80mm).
3. Click **Save Configuration**.

### Configuring the barcode label printer

1. Under **Barcode Label Printer**, pick the installed printer.
2. Fill in the label width/height (mm) for the labels this printer uses.
3. Click **Save Configuration**.

The A4 invoice printer and cash drawer printer follow the same pattern —
pick a printer under the matching section and save.

### Saving config

**Save Configuration** sends every role currently shown in the form to
`POST /config/printer-mappings` in one request. Leaving a role's printer
dropdown on "-- Not configured --" and saving un-maps that role; picking a
printer for a role that wasn't previously configured maps it. A success or
error banner appears at the top of the page after saving.

### Testing the setup page locally

```bash
npm run dev
```

Then open `http://127.0.0.1:17777/setup` in a browser. Because it's plain
HTML/CSS/JS with no build step, editing files under `src/setup-ui/` and
refreshing the page is enough to see changes — no rebuild required while
running under `npm run dev`.

To test the packaged exe instead:

```bash
npm run package:win
npm run prepare:release
release/PosPrintAgent/PosPrintAgent.exe
```

then open the same URL.

### How setup UI files are handled during packaging

The setup page is **plain static files copied beside the executable**, not
embedded into the exe. Concretely:

- Source of truth: `src/setup-ui/` (`index.html`, `setup.css`, `setup.js`).
- `npm run build` (`tsc` + `scripts/copy-setup-ui.js`) copies that folder to
  `dist/setup-ui/`, so `node dist/main.js` finds it next to the compiled
  routes the same way `tsx src/main.ts` finds `src/setup-ui/` next to the
  source routes.
- `npm run prepare:release` (`scripts/prepare-windows-release.js`) copies
  `src/setup-ui/` to `release/PosPrintAgent/setup-ui/`, alongside
  `PosPrintAgent.exe`.
- At runtime, [`src/routes/setup.routes.ts`](src/routes/setup.routes.ts)
  resolves the assets directory relative to `process.execPath` when running
  as a packaged (`pkg`) binary, or relative to the compiled/source file
  otherwise — see `resolveSetupUiDir()`.

This was chosen over embedding the assets into the `pkg` snapshot because
`pkg`'s virtual snapshot filesystem is a less predictable place to serve
static files from (asset globs, snapshot path quirks) than just reading
real files off disk. It also means updating the setup page's look and feel
doesn't require rebuilding the exe — only the `setup-ui` folder next to it
changes. The tradeoff: the `setup-ui` folder must be deployed and upgraded
alongside `PosPrintAgent.exe` (see
[Upgrading the Agent](#upgrading-the-agent) below) — if it's missing,
`GET /setup` responds with a clear `500 SETUP_UI_ASSETS_MISSING` error
instead of the page.

## Currently implemented endpoints

| Method | Path                       | Description                                               |
| ------ | -------------------------- | --------------------------------------------------------- |
| GET    | `/health`                  | Agent status, version, and per-role config state          |
| GET    | `/printers`                | Windows printers currently installed on this machine      |
| GET    | `/config`                  | Full current config for this machine                      |
| POST   | `/config/printer-mappings` | Replace the printer mappings for this machine             |
| GET    | `/setup`                   | Local HTML setup page (this agent's own UI, static files) |
| POST   | `/test-print`              | Send a test print to a role's configured printer          |

All error responses (from any route or unhandled exception) are shaped as:

```json
{
  "success": false,
  "errorCode": "INTERNAL_ERROR",
  "message": "Something went wrong"
}
```

## Running as a Windows Service

This agent is designed to run as a Windows service via
[WinSW](https://github.com/winsw/winsw), a lightweight service wrapper
(no MSI installer, no tray app).

- The WinSW executable must be renamed to `PosPrintAgentService.exe`.
- The WinSW config file must be named `PosPrintAgentService.xml` (WinSW
  looks for a same-named XML file next to its executable).
- Both files must sit in the same folder as `PosPrintAgent.exe`.
- The final deployment folder should be copied to:

  ```text
  C:\Pinnacle\PosPrintAgent
  ```

See [`deployment/windows-service/README.md`](deployment/windows-service/README.md)
for the full deployment folder layout, install/uninstall/start/stop
scripts, and upgrade instructions.

The rest of this section covers how `PosPrintAgent.exe` and the full
`release/PosPrintAgent` folder are actually produced.

### Building a Windows EXE

```bash
npm run package:win
```

This runs `npm run build` (TypeScript → `dist/`) and then packages
`dist/main.js` into a single self-contained executable using
[`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg):

```json
"package:win": "npm run build && pkg dist/main.js --targets node22-win-x64 --output release/PosPrintAgent/PosPrintAgent.exe"
```

**Why `@yao-pkg/pkg` instead of `pkg`, and why `node22` instead of `node20`:**
The original `vercel/pkg` package is unmaintained (last published in 2023)
and its prebuilt Node binary cache stops at Node 18/early Node 20 builds.
`@yao-pkg/pkg` is the actively maintained community fork with the same CLI
and config, but a current prebuilt binary cache. By now (Node 20 is EOL),
even that cache no longer carries Node 20 Windows binaries — only Node
22/24/26 — so building `node20-win-x64` falls back to compiling Node from
source, which requires a full native Windows build toolchain (Visual
Studio Build Tools) and is not something a support person's machine should
need. Targeting `node22-win-x64` uses a prebuilt binary and produces the
exe in seconds, with no native toolchain required.

The resulting `PosPrintAgent.exe`:

- Bundles the Node.js runtime, so **the POS counter machine does not need
  Node.js installed** and does not need `npm install` run on it.
- Does **not** embed `config.json`. Config paths
  (`src/config/config.paths.ts`) are hardcoded to
  `C:\ProgramData\Pinnacle\PosPrintAgent`, outside the packaged snapshot,
  so the exe reads/writes real files on disk at runtime exactly like the
  dev build does.
- Logs to `C:\ProgramData\Pinnacle\PosPrintAgent\logs` for the same reason.

### Preparing a Release Folder

```bash
npm run prepare:release
```

Runs [`scripts/prepare-windows-release.js`](scripts/prepare-windows-release.js),
which:

- Creates `release/PosPrintAgent` if it doesn't exist.
- Copies the WinSW config and the four `.bat` scripts from
  `deployment/windows-service` into it.
- Copies any static/setup assets (currently none — the agent has no
  bundled UI yet) if a `public/` or `static/` folder exists.
- Writes a support-person-oriented `release/PosPrintAgent/README.md`.
- Prints next steps, including a warning if `PosPrintAgent.exe` or
  `PosPrintAgentService.exe` are still missing from the folder.

Run both together with:

```bash
npm run release:win
```

After this, `release/PosPrintAgent` looks like:

```text
release/PosPrintAgent/
  PosPrintAgent.exe
  PosPrintAgentService.exe   <- WinSW, added manually (see below)
  PosPrintAgentService.xml
  install-service.bat
  uninstall-service.bat
  start-service.bat
  stop-service.bat
  README.md
```

`PosPrintAgentService.exe` is WinSW itself and is not produced by this
repo — download it once from the
[WinSW releases page](https://github.com/winsw/winsw/releases), rename it
to `PosPrintAgentService.exe`, and drop it into `release/PosPrintAgent`
(it doesn't change between agent releases, so this is a one-time step per
machine image).

### Deploying to a POS Counter

1. Copy `release/PosPrintAgent` to `C:\Pinnacle\PosPrintAgent` on the
   counter machine.
2. Make sure `PosPrintAgentService.exe` (WinSW) is present in that folder.
3. Run `install-service.bat` as Administrator.
4. Verify `http://127.0.0.1:17777/health`.

### Upgrading the Agent

1. Run `stop-service.bat` as Administrator.
2. Replace `PosPrintAgent.exe` in `C:\Pinnacle\PosPrintAgent` with the
   newly built one.
3. Run `start-service.bat` as Administrator.

Config and logs under `C:\ProgramData\Pinnacle\PosPrintAgent` are
untouched by an upgrade.

## What is intentionally not implemented yet

This is a skeleton. The following are out of scope for this change and left
for follow-up work:

- Printing endpoints (`POST /print/receipt`, `POST /print/barcode-label`,
  `POST /print/a4-invoice`).
- Cash drawer endpoint (`POST /cash-drawer/open`) — `POST /test-print` can
  send a text page to the printer feeding a drawer, but it does not send
  the raw ESC_POS kick command that actually opens one.
- Raw ESC_POS/TSPL/ZPL byte printing and real receipt/label/invoice
  rendering — `POST /test-print` proves the agent can reach a configured
  printer through the normal Windows print pipeline, but production print
  jobs (formatted receipts, barcode labels, PDF invoices) are not
  implemented yet.
- An endpoint to set `machineCode` at runtime (must still be edited by hand
  in `config.json`; the setup page shows it read-only for this reason).
- Authentication/signing of requests from the web POS.
- Structured/rotating log files (current logger is a flat append-only file).
