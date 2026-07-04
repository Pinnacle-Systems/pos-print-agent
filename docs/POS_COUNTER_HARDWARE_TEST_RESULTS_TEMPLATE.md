# POS Counter Hardware Test Results

Fill this in while working through
[POS_COUNTER_DEPLOYMENT_CHECKLIST.md](POS_COUNTER_DEPLOYMENT_CHECKLIST.md)
on a real counter. Copy this file per counter/pilot run (e.g.
`COUNTER-01-2026-07-04.md`) rather than overwriting it.

---

## Counter / Machine Details

- Counter / machine name:
- Location / store:
- Machine code (from `config.json` / setup page):

## Agent Version

- Agent version (`GET /version` → `version`):
- Build time (`GET /version` → `buildTime`):

## Windows Version

- Windows edition/build (`winver`):
- Node.js required on this machine? (should be **No** — the packaged exe
  bundles its own runtime):

## Printer Details

| Role | Printer make/model | Windows printer name | Connection (USB/Network/Serial) |
| --- | --- | --- | --- |
| Receipt | | | |
| Barcode label | | | |
| A4 invoice | | | |
| Cash drawer (via receipt printer) | | | |

## Installed File Checklist

- [ ] `PosPrintAgent.exe` present
- [ ] `PosPrintAgentService.exe` present
- [ ] `PosPrintAgentService.xml` present
- [ ] `SumatraPDF.exe` present (or N/A if A4 PDF not required)
- [ ] `install-service.bat` / `uninstall-service.bat` / `start-service.bat`
      / `stop-service.bat` present
- [ ] `smoke-test-local.ps1` present
- [ ] `backup-config.ps1` present
- [ ] `setup-ui\` folder present
- [ ] Files are directly inside `C:\Pinnacle\PosPrintAgent` (not nested)

Notes:

## Service Status

- [ ] `Get-Service PinnaclePosPrintAgent` shows `Running`
- [ ] StartType is `Automatic`
- [ ] Stop/start cycle (`stop-service.bat` → `start-service.bat`) completed
      cleanly

Notes:

## Health Check Result

- [ ] `/health` returns `"status": "ok"`
- [ ] `/version` returns expected version/buildTime
- [ ] `/setup` opens in browser

Notes (paste relevant `/health` JSON if anything looked off):

## Setup Configuration

- [ ] Printer list loaded on `/setup`
- [ ] Receipt printer selected, language set to ESC_POS
- [ ] Barcode label printer selected, language set to TSPL (or N/A)
- [ ] A4 invoice printer selected, language set to PDF (or N/A)
- [ ] Configuration saved successfully
- [ ] `/health` shows `"configured": true` and `printerInstalled: true` for
      every configured role

Notes:

## Receipt Test Result

- [ ] Receipt printed
- [ ] Text alignment acceptable
- [ ] Barcode printed
- [ ] QR printed
- [ ] Paper cut worked
- [ ] Drawer opened, if applicable

Notes:

## Barcode Label Test Result

- [ ] Label printed (not blank)
- [ ] Barcode visible and correctly positioned
- [ ] Text positioned correctly
- [ ] Label advanced correctly (no jam, correct gap detection)
- [ ] Barcode scanned successfully (if scanner available)

Notes:

## A4 PDF Test Result

- [ ] A4 printer mapped
- [ ] SumatraPDF.exe present
- [ ] Sample PDF request returned success
- [ ] Printer received the job
- [ ] PDF printed correctly on paper

Notes (include exact error code if it failed, e.g.
`PDF_PRINT_TOOL_NOT_FOUND`):

## Cash Drawer Test Result

- [ ] Drawer connected to receipt printer's drawer-kick port
- [ ] `openDrawer` instruction included in a test receipt job
- [ ] Drawer physically opened

Notes (N/A if no drawer at this counter):

## Issues Found

List every issue found during testing, however small, with enough detail
to reproduce (exact request sent, exact error code/message, printer
make/model):

1.
2.
3.

## Final Go / No-Go

- [ ] **Go** — counter is ready for live use
- [ ] **No-Go** — blocking issue(s) found (see Issues Found above)

Summary / reasoning:

## Tested By

- Name:
- Role:

## Date / Time

- Date:
- Start time:
- End time:
