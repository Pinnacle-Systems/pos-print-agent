# POS Counter Deployment Checklist

A hands-on checklist for installing Pinnacle POS Print Agent on one real
Windows POS counter and verifying it against actual printer hardware.
Intended audience: whoever is physically at the counter (support/IT), not
a developer.

Related: [POS_COUNTER_HARDWARE_TEST_RESULTS_TEMPLATE.md](POS_COUNTER_HARDWARE_TEST_RESULTS_TEMPLATE.md)
— fill this in while working through the checklist below.

---

## 1. Pre-Install Checklist

Confirm all of these before starting the install:

- [ ] Windows machine is available at the counter (this agent is Windows-only).
- [ ] You have Administrator access on that machine.
- [ ] Receipt printer is installed in Windows (**Settings → Printers & Scanners**
      shows it).
- [ ] Barcode label printer is installed in Windows, if this counter uses one.
- [ ] A4 printer is installed in Windows, if this counter prints A4 invoices.
- [ ] Cash drawer, if used, is physically connected to the receipt printer's
      drawer-kick port (not to the PC directly).
- [ ] A normal Windows test page prints successfully from each installed
      printer (right-click printer → **Printer properties** → **Print Test
      Page**), where applicable. If a printer can't print a plain Windows
      test page, the agent won't be able to print to it either — fix that
      first.
- [ ] The `PosPrintAgent` release zip is available on the counter machine
      (copied via USB, network share, etc.).
- [ ] `PosPrintAgentService.exe` (the renamed WinSW wrapper) is available —
      see [External Dependency Checklist](#2-external-dependency-checklist).
- [ ] `SumatraPDF.exe` is available, **only if** this counter needs A4 PDF
      printing.

**Install/data locations** (fixed, do not change):

| What | Where |
| --- | --- |
| App binaries | `C:\Pinnacle\PosPrintAgent` |
| Config, logs, temp files | `C:\ProgramData\Pinnacle\PosPrintAgent` |

---

## 2. External Dependency Checklist

Two files are **not committed to Git** and will not be in the release zip
unless someone added them manually before zipping (or you add them by hand
on the counter):

```text
PosPrintAgentService.exe
SumatraPDF.exe
```

**`PosPrintAgentService.exe`**
Required for Windows service installation. This is the
[WinSW](https://github.com/winsw/winsw/releases) executable, downloaded
once and renamed to `PosPrintAgentService.exe`. It doesn't change between
agent releases, so once you have a copy you can reuse it for every counter.

**`SumatraPDF.exe`**
Required only for A4 PDF printing (`a4-invoice` role). Must be placed
directly beside `PosPrintAgent.exe`. If this counter doesn't print A4
invoices, it can be omitted — every other role still works without it.

**Target folder layout** once both dependencies are added:

```text
C:\Pinnacle\PosPrintAgent\
  PosPrintAgent.exe
  PosPrintAgentService.exe
  PosPrintAgentService.xml
  SumatraPDF.exe              <- omit if A4 PDF printing not required
  install-service.bat
  uninstall-service.bat
  start-service.bat
  stop-service.bat
  smoke-test-local.ps1
  backup-config.ps1
  release-manifest.json
  README.md
  setup-ui\
```

---

## 3. Installation Steps

1. Copy the release zip (`PosPrintAgent-v<version>.zip`) to the POS counter.
2. Extract it.
3. Make sure the files land **directly inside** `C:\Pinnacle\PosPrintAgent`
   — not nested one level deeper.

   ```text
   Wrong:
   C:\Pinnacle\PosPrintAgent\PosPrintAgent\PosPrintAgent.exe

   Correct:
   C:\Pinnacle\PosPrintAgent\PosPrintAgent.exe
   ```

   Most zip tools extract into a subfolder named after the zip by default —
   check for this and move the files up a level if needed.
4. Add `PosPrintAgentService.exe` to that folder if it isn't already there.
5. Add `SumatraPDF.exe` to that folder if this counter needs A4 PDF printing.
6. Right-click `install-service.bat`.
7. Choose **Run as administrator**. (If you double-click instead of running
   as admin, the script detects this and exits with a clear error rather
   than failing silently.)
8. Confirm the console output ends with `Service installed and started.`
   and not a warning/error. If it warns that the service didn't start,
   check `C:\ProgramData\Pinnacle\PosPrintAgent\logs\agent.log` and the
   Windows Event Viewer (Application log) before continuing.

---

## 4. Verify Agent Health

**Browser checks** (open each in a browser on the counter machine):

```text
http://127.0.0.1:17777/health
http://127.0.0.1:17777/version
http://127.0.0.1:17777/setup
```

**PowerShell checks:**

```powershell
Invoke-RestMethod http://127.0.0.1:17777/health
Invoke-RestMethod http://127.0.0.1:17777/version
```

Expected outcome:

- [ ] `/health` returns `"status": "ok"`.
- [ ] `/version` returns a version string (e.g. `1.0.0`) and a `buildTime`.
- [ ] `/setup` opens the local setup page in the browser.

If none of these respond, the service likely isn't running — see
[Section 10, Service Verification](#10-service-verification).

---

## 5. Configure Printers in Setup Page

1. Open `http://127.0.0.1:17777/setup`.
2. Confirm the printer list loads (it should list every printer installed
   in Windows on this machine).
3. Under **Receipt Printer**, select the physical receipt printer.
4. Set its command language to **ESC_POS**.
5. Under **Barcode Label Printer**, select the label printer, if used.
6. Set its command language to **TSPL**.
7. Under **A4 Invoice Printer**, select the A4/laser printer, if used.
8. Set its command language to **PDF**.
9. Click **Save Configuration**.
10. Reopen `/health` and confirm `"configured": true`, and that each
    configured role shows `"printerInstalled": true`.

Printer config is saved locally to:

```text
C:\ProgramData\Pinnacle\PosPrintAgent\config.json
```

**Warning:** Do not copy `config.json` from another counter onto this one
unless the Windows printer names are identical on both machines. Printer
names (`windowsPrinterName`) are looked up exactly as Windows reports
them — a mismatched name means `printerInstalled: false` and print jobs
will fail with `WINDOWS_PRINTER_NOT_FOUND`.

---

## 6. Run Local Smoke Test Script

```powershell
cd C:\Pinnacle\PosPrintAgent
.\smoke-test-local.ps1
```

If Windows execution policy blocks the script:

```powershell
powershell -ExecutionPolicy Bypass -File .\smoke-test-local.ps1
```

Expected output:

- [ ] `health` → PASS
- [ ] `version` → PASS
- [ ] `printers` → PASS
- [ ] `config` → PASS
- [ ] `test-print` → PASS, or SKIPPED if the receipt printer isn't
      configured yet

A hard failure (non-zero exit code) means something is broken — check the
console output for which step failed before moving on to hardware testing.

---

## 7. Real Receipt Printer Test

Uses `POST /print` with `printRole: "receipt"`, `commandLanguage: "ESC_POS"`,
`payloadType: "PRINT_INSTRUCTIONS"`.

**Important:** do not include an `openDrawer` instruction unless a cash
drawer is actually wired into this printer's drawer-kick port — sending it
on a printer with no drawer connected is harmless, but there's nothing to
verify, so leave it out unless you're specifically testing the drawer.

```powershell
$body = @{
  jobId = "TEST-RECEIPT-001"
  printRole = "receipt"
  commandLanguage = "ESC_POS"
  payloadType = "PRINT_INSTRUCTIONS"
  copies = 1
  payload = @{
    width = 42
    instructions = @(
      @{ type = "text"; value = "PILOT COUNTER TEST"; align = "center"; bold = $true }
      @{ type = "leftRight"; left = "Invoice"; right = "TEST-001" }
      @{ type = "line" }
      @{ type = "leftRight"; left = "Grand Total"; right = "100.00"; bold = $true }
      @{ type = "blank"; lines = 1 }
      @{ type = "barcode"; value = "TEST001"; symbology = "CODE128" }
      @{ type = "blank"; lines = 1 }
      @{ type = "qr"; value = "https://example.com/test" }
      @{ type = "feed"; lines = 4 }
      @{ type = "cut"; mode = "full" }
      # Only add this line if a drawer is connected to this printer:
      # @{ type = "openDrawer" }
    )
  }
}
Invoke-RestMethod -Uri http://127.0.0.1:17777/print -Method Post `
  -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 6)
```

Equivalent curl (if testing from a non-Windows shell against the same
network-reachable agent):

```bash
curl -X POST http://127.0.0.1:17777/print \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "TEST-RECEIPT-001",
    "printRole": "receipt",
    "commandLanguage": "ESC_POS",
    "payloadType": "PRINT_INSTRUCTIONS",
    "copies": 1,
    "payload": {
      "width": 42,
      "instructions": [
        { "type": "text", "value": "PILOT COUNTER TEST", "align": "center", "bold": true },
        { "type": "leftRight", "left": "Invoice", "right": "TEST-001" },
        { "type": "line" },
        { "type": "leftRight", "left": "Grand Total", "right": "100.00", "bold": true },
        { "type": "barcode", "value": "TEST001", "symbology": "CODE128" },
        { "type": "qr", "value": "https://example.com/test" },
        { "type": "feed", "lines": 4 },
        { "type": "cut", "mode": "full" }
      ]
    }
  }'
```

**Expected physical results:**

- [ ] Receipt prints.
- [ ] Text alignment is acceptable (left/center/right lines look right).
- [ ] Barcode prints and is visually clean.
- [ ] QR code prints and is visually clean.
- [ ] Paper cut works (if the printer has an auto-cutter).
- [ ] Drawer opens — **only** if `openDrawer` was included and a drawer is
      connected.

**Troubleshooting:**

- Text prints but cut doesn't work → the printer may use a different cut
  command variant than the fixed `GS V 0`/`GS V 1` this agent sends. Check
  the printer's ESC/POS command reference.
- Barcode/QR doesn't print → the printer may not support the exact
  ESC/POS barcode/QR command variant this agent uses (this is a known,
  documented limitation — see the root README's "ESC/POS barcode command
  limitation" and "ESC/POS QR command limitation" sections).
- Drawer doesn't open → check the drawer cable is seated in the printer's
  drawer-kick port (RJ11/RJ12), and that the printer itself supports a
  drawer kick pulse. Also confirm `openDrawer` was actually included in
  the payload sent.

---

## 8. Real Barcode Label Printer Test

Uses `POST /print` with `printRole: "barcode-label"`,
`commandLanguage: "TSPL"`, `payloadType: "PRINT_INSTRUCTIONS"`.

```powershell
$body = @{
  jobId = "TEST-LABEL-001"
  printRole = "barcode-label"
  commandLanguage = "TSPL"
  payloadType = "PRINT_INSTRUCTIONS"
  copies = 1
  payload = @{
    labelWidthMm = 50
    labelHeightMm = 25
    gapMm = 3
    density = 8
    speed = 4
    direction = 1
    referenceX = 0
    referenceY = 0
    instructions = @(
      @{ type = "text"; x = 20; y = 20; value = "Test Label"; font = "3" }
      @{ type = "barcode"; x = 20; y = 60; value = "8901234567890"; symbology = "128"; height = 60; humanReadable = $true }
      @{ type = "box"; x = 10; y = 10; xEnd = 380; yEnd = 190; thickness = 2 }
    )
  }
}
Invoke-RestMethod -Uri http://127.0.0.1:17777/print -Method Post `
  -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 6)
```

**Expected physical results:**

- [ ] Label prints (not blank).
- [ ] Barcode is visible and correctly positioned.
- [ ] Text is positioned correctly relative to the barcode/box.
- [ ] Label advances correctly to the next label (no jamming, no skipped
      labels, gap sensor tracking correctly).
- [ ] Barcode scans successfully, if a barcode scanner is available.

**Troubleshooting:**

- Label prints blank → check the printer is actually in **TSPL** mode, not
  ZPL or another label language — some label printers auto-detect or need
  a DIP switch/menu setting changed.
- Position is wrong → adjust the instruction `x`/`y` coordinates; TSPL
  coordinates are dots from the label origin, not mm.
- Label size looks wrong (cropped, wrong gap detection) → double-check
  `labelWidthMm`/`labelHeightMm`/`gapMm` match the actual label stock
  loaded in the printer.
- Barcode doesn't scan → try adjusting `narrow`/`wide` module widths or
  `height`; very small/dense barcodes are harder for some scanners to read.

---

## 9. Real A4 PDF Print Test

Requires `SumatraPDF.exe` to be present beside `PosPrintAgent.exe`.

Uses `POST /print` with `printRole: "a4-invoice"`, `commandLanguage: "PDF"`,
`payloadType: "PDF"`, `payloadEncoding: "base64"`.

**Checklist before sending a test job:**

- [ ] A4 printer is mapped to the `a4-invoice` role on the setup page.
- [ ] `SumatraPDF.exe` exists in `C:\Pinnacle\PosPrintAgent`.
- [ ] You have a small sample PDF to send.

**Generating a base64 payload from any small PDF:**

```powershell
$bytes = [System.IO.File]::ReadAllBytes("C:\Temp\sample.pdf")
$base64 = [System.Convert]::ToBase64String($bytes)
$body = @{
  jobId = "TEST-A4-001"
  printRole = "a4-invoice"
  commandLanguage = "PDF"
  payloadType = "PDF"
  payloadEncoding = "base64"
  copies = 1
  payload = $base64
}
Invoke-RestMethod -Uri http://127.0.0.1:17777/print -Method Post `
  -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 6)
```

Any small PDF works for this test (an exported Word/PDF doc, a print-to-PDF
of any web page, etc.) — the agent doesn't inspect PDF content beyond its
header and size.

**Expected results:**

- [ ] Request returns `"success": true`.
- [ ] Printer receives and processes the job (check the Windows print
      queue if unsure).
- [ ] PDF actually prints on paper, correctly formatted.

**Troubleshooting:**

- `PDF_PRINT_TOOL_NOT_FOUND` → `SumatraPDF.exe` is missing, or not in one
  of the locations the agent checks (beside `PosPrintAgent.exe` is the
  packaged-deployment location). Confirm the file is actually there and
  named exactly `SumatraPDF.exe`.
- PDF prints fine when the agent is run interactively (`npm run dev` /
  double-clicking the exe) but not when running as the Windows service →
  likely a service-account printer access issue. Windows services run
  under `LocalSystem` by default, which may not have the same printer
  access as an interactive user session, especially for network printers.
- Network A4 printers may need to be explicitly installed/available to the
  service account (`LocalSystem`), not just to the logged-in user account —
  this has not been broadly verified and may need per-machine
  troubleshooting.

---

## 10. Service Verification

Check the service is installed and running:

```powershell
Get-Service PinnaclePosPrintAgent
```

Expected:

```text
Status    : Running
StartType : Automatic
```

**Restart test** — confirms the service survives a stop/start cycle
cleanly (not just that the initial install worked):

```powershell
cd C:\Pinnacle\PosPrintAgent
.\stop-service.bat
.\start-service.bat
```

Then verify it's back up:

```powershell
Invoke-RestMethod http://127.0.0.1:17777/health
```

- [ ] `Get-Service PinnaclePosPrintAgent` shows `Running` / `Automatic`.
- [ ] Stop/start cycle completes without errors.
- [ ] `/health` responds again after restart.

---

## 11. Log Collection

Logs live at:

```text
C:\ProgramData\Pinnacle\PosPrintAgent\logs
```

If asked to send logs to support, collect:

- `agent.log`
- WinSW's own service wrapper logs, if present (also under the same
  `logs` folder, per `PosPrintAgentService.xml`'s `<logpath>`).

**If a print test fails, also collect:**

- [ ] Screenshot of `/health`.
- [ ] Screenshot of `/setup`.
- [ ] `config.json` (from `C:\ProgramData\Pinnacle\PosPrintAgent`).
- [ ] The latest log file.
- [ ] Printer make/model.
- [ ] Printer driver name (as shown in Windows).
- [ ] Exact Windows printer name (from `GET /printers` or Windows
      **Printers & Scanners**).
- [ ] The exact test payload used.

**Do not share customer-sensitive receipt/PDF payloads** (real invoices,
real customer data) unless it's specifically required for debugging — use
a synthetic test payload like the ones in this checklist wherever
possible. Note: the agent's own logs never contain full receipt/label
text, barcode/QR values, or PDF content — only metadata (job id, role,
printer name, byte counts, success/failure) — so `agent.log` itself is
safe to share as-is.

---

## 12. Rollback / Uninstall

**To stop the service:**

```powershell
cd C:\Pinnacle\PosPrintAgent
.\stop-service.bat
```

**To uninstall the service:**

```powershell
cd C:\Pinnacle\PosPrintAgent
.\uninstall-service.bat
```

Uninstalling removes the Windows service registration only — it does
**not** delete `config.json`, logs, or temp files.

**To fully reset this counter's local printer configuration** (only do
this if you intentionally want to wipe printer mappings and start over):

1. `stop-service.bat`
2. `uninstall-service.bat`
3. Delete `C:\ProgramData\Pinnacle\PosPrintAgent`

**Warning:** deleting `C:\ProgramData\Pinnacle\PosPrintAgent` removes this
counter's local printer mappings (`config.json`) permanently. Consider
running `backup-config.ps1` first (see the root/release README's
"Upgrading the agent" section) if there's any chance you'll want the
mappings back.

---

## Done

Once every checkbox above is checked, fill in
[POS_COUNTER_HARDWARE_TEST_RESULTS_TEMPLATE.md](POS_COUNTER_HARDWARE_TEST_RESULTS_TEMPLATE.md)
with the final results and Go/No-Go decision for this counter.
