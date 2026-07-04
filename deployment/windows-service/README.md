# Windows Service Packaging (WinSW)

This folder contains everything needed to run the POS Print Agent as a
Windows service, using [WinSW](https://github.com/winsw/winsw) as a
lightweight service wrapper.

This is intentionally **not** an installer. There is no MSI and no setup
wizard — you copy a folder and run a `.bat` file as Administrator.

## What WinSW is for

`PosPrintAgent.exe` is a plain executable; Windows cannot start a plain
executable as a service on its own. WinSW is a small, well-established
wrapper that:

- Registers itself as a Windows service.
- Launches `PosPrintAgent.exe` as a child process when the service starts.
- Restarts the agent automatically if it crashes.
- Writes rolling log files for the wrapper itself.

WinSW is configured entirely through the `PosPrintAgentService.xml` file in
this folder — no code changes are needed.

## Expected deployment folder structure

Everything below must live in the **same folder** on the target machine:

```text
C:\Pinnacle\PosPrintAgent\
  PosPrintAgent.exe          <- the packaged agent (built separately)
  setup-ui\                  <- static setup page assets (served at /setup)
  SumatraPDF.exe             <- PDF print adapter, required for a4-invoice printing
  PosPrintAgentService.exe   <- WinSW, renamed to this exact name
  PosPrintAgentService.xml   <- WinSW config (from this folder)
  install-service.bat
  uninstall-service.bat
  start-service.bat
  stop-service.bat
```

Notes:

- **`PosPrintAgent.exe`**: the built print agent binary. Place it directly
  in `C:\Pinnacle\PosPrintAgent`.
- **`setup-ui\`**: plain HTML/CSS/JS for the `/setup` page. `PosPrintAgent.exe`
  reads these files straight off disk at runtime (they are not embedded in
  the exe), so this folder must sit next to the exe. It is produced by
  `npm run prepare:release` from `src/setup-ui`.
- **`SumatraPDF.exe`**: only required if this counter prints A4 invoices
  (`POST /print` with `payloadType: "PDF"`) — receipt/ESC_POS printing does
  not need it. The agent looks for it beside `PosPrintAgent.exe`; if it's
  missing, PDF print jobs fail with `PDF_PRINT_TOOL_NOT_FOUND` instead of
  falling back to opening the PDF in a viewer. See
  [Adding SumatraPDF.exe](#adding-sumatrapdfexe) below.
- **`PosPrintAgentService.exe`**: download the WinSW executable from the
  [WinSW releases page](https://github.com/winsw/winsw/releases) and rename
  it to `PosPrintAgentService.exe`. WinSW automatically looks for a
  same-named `.xml` file next to it, which is why the name must match
  `PosPrintAgentService.xml` exactly.
- Config and logs are **not** stored next to the executable. They live under
  `C:\ProgramData\Pinnacle\PosPrintAgent`, so upgrading or reinstalling the
  executable never touches machine-specific configuration. PDF print jobs
  also use a `temp\` subfolder there for the duration of each print (see
  [Verifying PDF printing](#verifying-pdf-printing)).

## Install the service

1. Copy the full deployment folder to `C:\Pinnacle\PosPrintAgent` on the
   target machine.
2. Right-click `install-service.bat` and choose **Run as administrator**.

This creates `C:\ProgramData\Pinnacle\PosPrintAgent` (and its `logs`
subfolder) if they don't exist, registers the service, sets it to start
automatically on boot, and starts it immediately.

## Uninstall the service

Right-click `uninstall-service.bat` and choose **Run as administrator**.

This stops and removes the Windows service. It does **not** delete
`C:\ProgramData\Pinnacle\PosPrintAgent` — local config and logs are
intentionally preserved so reinstalling the service later picks up the
same printer mappings without reconfiguration.

## Start / stop the service manually

- `start-service.bat` — starts the service if it is stopped.
- `stop-service.bat` — stops the service if it is running.

Both require Administrator privileges.

## Verifying the service is running

Once installed and started, check the health endpoint from the same
machine:

```text
http://127.0.0.1:17777/health
```

A healthy agent returns a JSON body with `"status": "ok"`.

For configuration (printer mappings, machine code), open:

```text
http://127.0.0.1:17777/setup
```

## Adding SumatraPDF.exe

Only needed for counters that print A4 invoices. Receipt printing (ESC/POS)
does not use SumatraPDF.

1. Obtain `SumatraPDF.exe` (the portable/single-file build — see
   [sumatrapdfreader.org](https://www.sumatrapdfreader.org/download-free-pdf-viewer)).
   This project does not download or bundle it automatically; it's a
   third-party binary you place manually.
2. Copy it into `C:\Pinnacle\PosPrintAgent`, next to `PosPrintAgent.exe`.
3. Confirm the agent can see it — see
   [Verifying PDF printing](#verifying-pdf-printing) below.

If you're building the release folder yourself (`npm run prepare:release`
on a dev machine), placing a copy at `tools/SumatraPDF.exe` in the project
root gets it copied into `release/PosPrintAgent` automatically; the script
prints a warning if it's still missing when the release folder is prepared.

## Verifying PDF printing

1. Confirm an `a4-invoice` printer mapping is saved with
   `commandLanguage: "PDF"` — via `POST /config/printer-mappings` or the
   [setup page](http://127.0.0.1:17777/setup).
2. Send a `POST /print` request with `payloadType: "PDF"` (see root
   `README.md` for the full request shape) — either from the real web POS,
   or with a small test PDF base64-encoded by hand.
3. A success response looks like:

   ```json
   { "success": true, "jobId": "...", "printRole": "a4-invoice", "commandLanguage": "PDF", "payloadType": "PDF", "printerName": "...", "copies": 1, "message": "PDF print job sent successfully" }
   ```

4. Check `C:\ProgramData\Pinnacle\PosPrintAgent\logs\agent.log` for the
   structured log line (`pdfSizeBytes`, `tempFilePath`, `printerName`,
   `success`) to confirm what actually happened.
5. The temp PDF file under `C:\ProgramData\Pinnacle\PosPrintAgent\temp` is
   deleted automatically after each print attempt; it should not
   accumulate over time.

### Troubleshooting PDF_PRINT_TOOL_NOT_FOUND

This means the agent could not find `SumatraPDF.exe` in any of its known
locations (beside `PosPrintAgent.exe`, or the `sumatraPdfPath` override in
`config.json`, if set).

- Confirm `SumatraPDF.exe` is literally in `C:\Pinnacle\PosPrintAgent`,
  spelled exactly that way (case doesn't matter on Windows, but the
  filename must match).
- If it's stored somewhere else on this machine, add
  `"sumatraPdfPath": "C:\\path\\to\\SumatraPDF.exe"` to `config.json` and
  restart the service.
- This error is intentional, not a bug: the agent will not silently fall
  back to opening the PDF in a viewer or showing a print dialog.

### Troubleshooting service account printer access issues

The Windows service runs as whatever account WinSW is configured for
(typically `LocalSystem` unless changed in `PosPrintAgentService.xml`).
That account needs its own access to the target printer — it does not
inherit the printers visible to whichever user is logged into the
counter interactively.

- Check `GET /printers` (or the setup page) **while the service is
  running**, not just when you tested manually from an interactive
  PowerShell/`npm run dev` session — the printer list can differ between
  the two.
- Local USB printers are the primary MVP target and are generally visible
  to `LocalSystem`. Network printers may require the service to run under
  a domain/local account that has been granted access to that printer
  share, rather than `LocalSystem`.
- If `GET /printers` doesn't list the expected printer under the service
  account, that's a Windows printer-permissions problem, not something
  `PosPrintAgent.exe` can work around — grant the service account access
  to the printer (or run the service as a different account) before
  retrying.

## Upgrading the agent

1. Run `stop-service.bat` (or let `install-service.bat` handle a fresh
   install — either way the service must not be holding the old exe open).
2. Replace `PosPrintAgent.exe` in `C:\Pinnacle\PosPrintAgent` with the new
   build.
3. Replace the `setup-ui` folder with the new one, in case the setup page
   changed.
4. Run `start-service.bat`.

`PosPrintAgentService.exe` and `PosPrintAgentService.xml` do not need to
change for an agent upgrade — only `PosPrintAgent.exe` and `setup-ui` are
replaced. Config under `C:\ProgramData\Pinnacle\PosPrintAgent` is untouched
by an upgrade.
