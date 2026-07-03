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
- WinSW service wrapper files (`.xml` config, install scripts) — this
  project only produces the executable `dist/main.js` that WinSW would run.
- Structured/rotating log files (current logger is a flat append-only file).
