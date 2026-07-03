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
  "configured": false,
  "printerMappings": {}
}
```

`configured` is `true` only once the machine has a non-empty `machineCode`
and at least one entry in `printerMappings`.

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

## Currently implemented endpoints

| Method | Path      | Description                          |
| ------ | --------- | ------------------------------------ |
| GET    | `/health` | Agent status, version, and config state |

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
- Cash drawer endpoint (`POST /cash-drawer/open`).
- Actual Windows printer enumeration / spooling integration.
- Any endpoint to read/update `printerMappings` or `machineCode` at runtime
  (currently config is only read, and must be edited by hand or by a future
  admin endpoint).
- Authentication/signing of requests from the web POS.
- Structured/rotating log files (current logger is a flat append-only file).
