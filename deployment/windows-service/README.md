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
- **`PosPrintAgentService.exe`**: download the WinSW executable from the
  [WinSW releases page](https://github.com/winsw/winsw/releases) and rename
  it to `PosPrintAgentService.exe`. WinSW automatically looks for a
  same-named `.xml` file next to it, which is why the name must match
  `PosPrintAgentService.xml` exactly.
- Config and logs are **not** stored next to the executable. They live under
  `C:\ProgramData\Pinnacle\PosPrintAgent`, so upgrading or reinstalling the
  executable never touches machine-specific configuration.

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
