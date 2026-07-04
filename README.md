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

## Dumb bridge plus print-instruction design

This agent is a **dumb bridge**, not a receipt-rendering engine. It has no
opinion about invoices, GST, discounts, offer reversal, item rows, or
payment correctness — that is all POS/backend business logic, and none of
it belongs here.

The split is:

- **POS/backend** owns receipt content and layout, *and* owns final
  document layout for A4 invoices/reports. For receipts it reduces content
  down to a small, generic instruction list (`text` / `line` / `feed` /
  `cut`); for A4 invoices it generates the final PDF itself.
- **Local agent** (this project) owns *local* printer mapping only. For
  receipts, it converts the generic instruction list into printer-specific
  command bytes (ESC/POS for now). For A4 invoices, it takes the
  already-finished PDF as-is and hands it to a PDF-aware print tool. Either
  way, it sends the result to whichever Windows printer is mapped to that
  print role on this counter — it never generates layout itself.

### Why the agent does not accept invoice JSON

If the agent understood invoice shape (line items, tax breakdown, offers,
payment method), every POS business rule change — a new discount type, a
reworded tax line, a layout tweak — would require redeploying the agent to
every counter machine. Keeping the agent ignorant of invoice JSON means
POS/backend can change receipt content and layout freely without ever
touching code running on counter hardware. The agent only ever sees
`{ type: "text", value: "...", ... }` — never `{ gstAmount, discountRows,
offerId, ... }`.

### Why the public /print API does not accept RAW_COMMAND

The agent *internally* generates raw ESC/POS bytes (see
[Raw Printing Diagnostic](#raw-printing-diagnostic) — that adapter already
exists and is reused here), but `POST /print` does not let a caller hand it
raw command bytes directly. Two reasons:

- Raw bytes are printer/command-language-specific and easy to get subtly
  wrong (wrong cut command, wrong code page, malformed escape sequence) —
  the web POS should never need to know ESC/POS byte sequences at all.
- It keeps the architecture boundary honest: if the public API accepted
  raw bytes, nothing would stop POS/backend from building printer-specific
  logic on the wrong side of the boundary, quietly reintroducing the exact
  coupling this design avoids.

`RAW_COMMAND` is a recognized concept in the wider system's `payloadType`
vocabulary, but it is intentionally not implemented in `POST /print` — see
[Error codes](#error-codes) below.

### Why PDF uses a separate path from raw ESC/POS

A4 invoices, delivery challans, and reports are document-style output, not
receipt instructions, so they get a completely separate internal path:

```text
PRINT_INSTRUCTIONS → ESC/POS instruction renderer → raw print adapter → receipt printer
PDF                → decode base64 → temp PDF file → PDF print adapter → Windows printer
```

The raw print adapter (`sendRawToPrinter()`) writes bytes straight to the
spooler's `RAW` datatype — that's exactly right for ESC/POS/TSPL/ZPL
command bytes, but a normal A4 printer driver does not accept raw PDF
bytes through `WritePrinter`; PDF rendering needs a PDF-aware tool in the
loop. So PDF printing:

- Never calls `sendRawToPrinter()` or touches `raw-print.service.ts`.
- Decodes and validates the PDF, writes it to a temp file, and hands that
  file to SumatraPDF (see
  [SumatraPDF requirement](#sumatrapdf-requirement)), which does the actual
  PDF rendering and submits the print job through the normal Windows
  driver pipeline.
- Never generates the PDF itself — POS/backend owns invoice layout, GST,
  tax, discounts, and item logic entirely; the agent only ever receives
  the finished PDF bytes and sends them onward.

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
a cash drawer. Production receipt printing is `POST /print` (below); cash
drawer opening remains future work (see
[Current limitations](#current-limitations)).

Errors:

- `400 INVALID_PRINT_ROLE` — `role` is missing or not one of the
  [supported print roles](#supported-print-roles).
- `400 PRINT_ROLE_NOT_CONFIGURED` — that role has no saved printer mapping
  yet; save one via `POST /config/printer-mappings` (or the setup page)
  first.
- `502 TEST_PRINT_FAILED` — the mapped printer exists in config but
  Windows/PowerShell couldn't spool a job to it (e.g. printer removed,
  offline, or a permissions issue).

### POST /print

Accepts a generic print job — logical `printRole` + `commandLanguage` +
a `payloadType` describing the shape of `payload` — resolves it to a
physical printer locally, and sends printer-appropriate output to it. This
is the real print path the web POS should call for production printing;
`POST /test-print` remains a connectivity smoke test only.

Currently implemented — exactly two `printRole` / `commandLanguage` /
`payloadType` combinations:

| `printRole`  | `commandLanguage` | `payloadType`       | What happens                                    |
| ------------ | ------------------ | ------------------- | ------------------------------------------------ |
| `receipt`    | `ESC_POS`           | `PRINT_INSTRUCTIONS`| Generic instructions rendered to ESC/POS locally |
| `a4-invoice` | `PDF`               | `PDF`                | A caller-generated PDF sent via a PDF-aware print tool |

**`RAW_COMMAND` is never accepted here**, for either role — see
[Why the public /print API does not accept RAW_COMMAND](#why-the-public-print-api-does-not-accept-raw_command).

Everything else (`barcode-label`, `cash-drawer`, `TSPL`, `ZPL`,
`WINDOWS_DRIVER`) is a recognized value elsewhere in the system but not
implemented by this endpoint yet — see
[Current limitations](#current-limitations).

#### PRINT_INSTRUCTIONS (receipt)

##### Instruction types

| Type         | Fields                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `text`       | `value` (string, ≤500 chars), `align` (`left`\|`center`\|`right`, default `left`), `bold` (default `false`), `underline` (default `false`), `size` (`normal`\|`double-width`\|`double-height`\|`double`, default `normal`) |
| `line`       | `char` (single printable character, default `-`) — repeated to `payload.width` |
| `feed`       | `lines` (1–10) |
| `cut`        | `mode` (`full`\|`partial`, default `full`) |
| `leftRight`  | `left` (string, required, ≤250 chars), `right` (string, required, ≤100 chars), `bold`/`underline`/`size` (same defaults as `text`) |
| `blank`      | `lines` (1–5, default `1`) |
| `openDrawer` | no fields |
| `barcode`    | `value` (string, required, ≤80 chars), `symbology` (`CODE128`\|`EAN13`, default `CODE128`), `height` (40–160, default `80`), `width` (2–6, default `2`), `humanReadable` (`none`\|`above`\|`below`\|`both`, default `below`), `align` (default `center`) |
| `qr`         | `value` (string, required, ≤500 chars), `size` (3–10, default `6`), `errorCorrection` (`L`\|`M`\|`Q`\|`H`, default `M`), `align` (default `center`) |

`payload.width` (default `42`, must be 32–48) sets both the `line`
character count and is otherwise informational for the caller — it does
not currently drive text wrapping.

##### leftRight — totals and label/value rows

`leftRight` prints one line with `left` flush against the start and
`right` right-aligned to fill `payload.width`, so POS/backend doesn't have
to hand-pad totals with spaces itself:

```json
{ "type": "leftRight", "left": "Grand Total", "right": "1300.00", "bold": true }
```

At `width: 42` this renders as:

```text
Grand Total                         1300.00
```

If `left` and `right` together (plus one separating space) would exceed
`payload.width`, the renderer keeps `right` fully visible and truncates
`left` to whatever space remains, rather than failing the print job — e.g.
at `width: 20`, `left: "Very Long Product Name"` with
`right: "123.00"` becomes `Very Long Pro 123.00` (19 chars: 13 truncated
from `left`, a space, then the full `right`). See
[`escpos-instruction.renderer.ts`](src/print-instructions/escpos-instruction.renderer.ts)'s
`formatLeftRight()` for the exact rule, and its
[tests](src/print-instructions/escpos-instruction.renderer.test.ts) for
worked examples.

##### blank vs feed

Both add vertical space, but they mean different things:

- `feed` is a printer-movement instruction — "advance the paper N lines,"
  used mechanically (e.g. before a cut, so the cutter doesn't shear
  printed text).
- `blank` is a layout instruction — "leave a visible gap here," used the
  way you'd use blank lines in a template (spacing between sections of a
  receipt). It happens to render as the same LF bytes as `feed`, but the
  two are named separately so POS/backend's receipt templates read as
  intent ("blank line between header and items") rather than raw printer
  mechanics.

##### openDrawer

```json
{ "type": "openDrawer" }
```

Emits the ESC/POS cash drawer kick command (`ESC p 0 25 250` — see
[ESC/POS drawer command limitation](#rendering-escpos) below) as part of
the instruction sequence.

**The agent never opens the drawer on its own.** A receipt does not open
the cash drawer unless the instruction sequence explicitly includes
`openDrawer` — POS/backend decides when that should happen (e.g. only for
cash payments, not card), the same way it decides everything else about
receipt content. There is currently no separate `/cash-drawer/open`
endpoint; this instruction is the only way to open the drawer via
`POST /print` today.

**Warning:** this only sends the standard ESC/POS drawer kick command to
whatever printer is mapped to `receipt`. Whether the drawer physically
opens depends on it being wired into that printer's drawer-kick port and
wanting this exact pulse timing — that still requires testing with real
drawer hardware connected to the configured receipt printer; nothing here
has been verified against a physical drawer.

##### barcode — 1D barcodes (invoice/return/token references)

`barcode` prints a one-dimensional barcode, for whatever reference the
POS/backend decides to encode (invoice number, return lookup, token
number, customer reference, ...). The agent has no idea what the value
*means* — it just encodes whatever string it's given.

```json
{
  "type": "barcode",
  "value": "INV1001",
  "symbology": "CODE128",
  "height": 80,
  "width": 2,
  "humanReadable": "below",
  "align": "center"
}
```

Supported `symbology` values (this prompt only):

- `CODE128` (default) — general-purpose alphanumeric barcode. The
  renderer prefixes the value with `{B` to select Code Set B, so it
  covers the same printable-ASCII range as `text`/`leftRight` (see
  [ESC/POS barcode command limitation](#escpos-barcode-command-limitation)).
- `EAN13` — the retail 12/13-digit barcode. `value` must be exactly 12
  or 13 numeric digits or the job is rejected with
  `INVALID_PRINT_PAYLOAD` before anything is sent to the printer.

`height` (40–160, default `80`) and `width` (2–6, default `2`) are raw
ESC/POS dot-based parameters, not physical units — larger values make a
taller/wider barcode but exact millimeters depend on printer DPI.
`humanReadable` controls whether the encoded text is printed as
readable characters `above`/`below`/`both` the bars, or `none` at all.

##### qr — QR codes (payment/URL/loyalty links)

`qr` prints a QR code, for whatever the POS/backend wants scanned
(payment QR, online invoice URL, return verification link, loyalty/
customer link, ...) — again, the agent only encodes the string.

```json
{
  "type": "qr",
  "value": "https://example.com/invoice/INV-1001",
  "size": 6,
  "errorCorrection": "M",
  "align": "center"
}
```

`size` (3–10, default `6`) is the QR module size in printer dots per
module — larger values produce a bigger, easier-to-scan code at the cost
of paper width. `errorCorrection` (`L`\|`M`\|`Q`\|`H`, default `M`) trades
scan robustness against damage/dirt for QR code density; `H` survives
more physical damage but packs less data into the same size.

##### Example request (PRINT_INSTRUCTIONS)

```bash
curl -X POST http://127.0.0.1:17777/print \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "INV-1001",
    "printRole": "receipt",
    "commandLanguage": "ESC_POS",
    "payloadType": "PRINT_INSTRUCTIONS",
    "copies": 1,
    "payload": {
      "width": 42,
      "instructions": [
        { "type": "text", "value": "MY STORE", "align": "center", "bold": true },
        { "type": "text", "value": "Coimbatore", "align": "center" },
        { "type": "text", "value": "Invoice: INV-1001" },
        { "type": "line" },
        { "type": "text", "value": "Grand Total                1000.00", "bold": true },
        { "type": "feed", "lines": 4 },
        { "type": "cut", "mode": "full" }
      ]
    }
  }'
```

##### Example response (PRINT_INSTRUCTIONS)

```json
{
  "success": true,
  "jobId": "INV-1001",
  "printRole": "receipt",
  "commandLanguage": "ESC_POS",
  "payloadType": "PRINT_INSTRUCTIONS",
  "printerName": "EPSON TM-T82X Receipt",
  "copies": 1,
  "message": "Print instructions sent successfully"
}
```

Validated in this order (see
[`src/print-jobs/print-job.service.ts`](src/print-jobs/print-job.service.ts)):
request shape → `printRole` supported/implemented → `commandLanguage`
recognized → `payloadType` supported → each instruction's `type` known →
full instruction-list shape → role has a saved mapping → mapped printer
still installed → `commandLanguage` matches the mapping. See
[Error codes](#error-codes) below (shared with the PDF path).

##### Rendering (ESC/POS)

[`src/print-instructions/escpos-instruction.renderer.ts`](src/print-instructions/escpos-instruction.renderer.ts)
converts the validated instruction list into a `Buffer` using a
conservative, well-documented ESC/POS command set:

| Command   | Bytes         | Purpose                        |
| --------- | ------------- | ------------------------------- |
| `ESC @`   | `1B 40`       | Initialize printer               |
| `ESC a n` | `1B 61 n`     | Align left(0)/center(1)/right(2) |
| `ESC E n` | `1B 45 n`     | Bold on(1)/off(0)                 |
| `ESC - n` | `1B 2D n`     | Underline on(1)/off(0)             |
| `GS ! n`  | `1D 21 n`     | Text size (width/height multiplier nibbles) |
| `LF`      | `0A`          | Line feed                          |
| `GS V m`  | `1D 56 m`     | Paper cut: full(0)/partial(1)        |
| `ESC p m t1 t2` | `1B 70 00 19 FA` | Cash drawer kick (fixed pulse, see below) |
| `GS h n`  | `1D 68 n`     | Barcode height (dots)               |
| `GS w n`  | `1D 77 n`     | Barcode width (module multiplier)    |
| `GS H n`  | `1D 48 n`     | Barcode human-readable text position: none(0)/above(1)/below(2)/both(3) |
| `GS k m n d1...dn` | `1D 6B m n ...` | Print barcode: CODE128(m=73)/EAN13(m=67), explicit-length form |
| `GS ( k ... fn=65` | `1D 28 6B 04 00 31 41 32 00` | Select QR model (fixed to model 2) |
| `GS ( k ... fn=67` | `1D 28 6B 03 00 31 43 n` | Set QR module size |
| `GS ( k ... fn=69` | `1D 28 6B 03 00 31 45 n` | Set QR error correction level |
| `GS ( k ... fn=80` | `1D 28 6B pL pH 31 50 30 ...` | Store QR data (length-prefixed) |
| `GS ( k ... fn=81` | `1D 28 6B 03 00 31 51 30` | Print the stored QR code |

Each `text` and `leftRight` instruction resets bold/underline/size back to
defaults after its line (and `text` additionally resets alignment), so
style never leaks into the next instruction. Each `cut` instruction adds a
small fixed safety feed (3 lines) before the cut bytes, on top of whatever
explicit `feed` instructions the payload already included — see
[Current limitations](#current-limitations) for why. `blank` renders as
plain `LF` bytes, identical to `feed` — see
[blank vs feed](#blank-vs-feed) above for why they're still separate
instruction types. Both `barcode` and `qr` set alignment before printing
and reset it back to `left` afterward, followed by a trailing line feed —
see [barcode](#barcode--1d-barcodes-invoicereturntoken-references) and
[qr](#qr--qr-codes-paymenturlloyalty-links) above.

###### ESC/POS drawer command limitation

`openDrawer` always emits the same fixed pulse — `ESC p 0 25 250`
(`1B 70 00 19 FA`): pin 2, ~25ms on, ~250ms off. This is a conservative,
widely-supported default, not a value read from config or tuned per
printer/drawer model. It is intentionally isolated in one function
(`escPosOpenDrawer()` in the renderer) so a different pulse or pin can be
substituted later without touching anything else. See
[openDrawer](#opendrawer) above for the "never opens automatically" rule,
and [Current limitations](#current-limitations) for hardware-testing
status.

###### ESC/POS barcode command limitation

`barcode` uses the "function B" (explicit-length) form of `GS k`, and for
`CODE128` prefixes the value with `{B` to select Code Set B. This is a
conservative, widely-used convention on Epson-compatible printers, but
**barcode command support and the exact prefixing convention vary across
ESC/POS printer models** — some clones interpret the function-B length
byte or the `{`-prefix differently. `EAN13` is comparatively low-risk (no
prefixing, industry-standard 12/13-digit encoding), but `CODE128` output
should be scanned with real hardware before depending on it in
production. See [Current limitations](#current-limitations).

###### ESC/POS QR command limitation

QR support uses the Epson "GS ( k" custom-function command set (model 2,
fixed), which is broadly supported on Epson and Epson-compatible thermal
printers but, like barcodes, **is not universal across every ESC/POS
printer model** — some cheaper/generic printers don't implement QR at
all. See [Current limitations](#current-limitations).

The rendered `Buffer` is sent through the exact same raw print adapter
used by `POST /diagnostics/raw-print` (`sendRawToPrinter()` in
[`src/printers/raw-print.service.ts`](src/printers/raw-print.service.ts)) —
`POST /print` does not talk to Windows directly, and does not duplicate
the raw-printing mechanism.

##### Testing with a Generic / Text Only printer mapped to a file

To verify end to end without real thermal hardware:

1. In Windows, add a printer using the **Generic / Text Only** driver.
2. Point its port at a specific file instead of the interactive `FILE:`
   port, so printing doesn't hang waiting for a "Save As" dialog:
   ```powershell
   Add-PrinterPort -Name "C:\Temp\raw-printer-output.prn"
   Set-Printer -Name "<your printer name>" -PortName "C:\Temp\raw-printer-output.prn"
   ```
3. Map it to `receipt` with `commandLanguage: "ESC_POS"` via
   `POST /config/printer-mappings` (or the setup page).
4. `POST /print` with a `PRINT_INSTRUCTIONS` payload (see example above).
5. Inspect the result:
   ```powershell
   Format-Hex C:\Temp\raw-printer-output.prn
   ```
   You should see `1B 40` (init) at the start, your receipt text as
   readable ASCII in the middle, and `1D 56 00` (full cut) near the end.

##### Testing barcode and QR printing

Same file-redirected setup as above. Send a payload with `barcode` and/or
`qr` instructions:

```bash
curl -X POST http://127.0.0.1:17777/print \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "INV-1003",
    "printRole": "receipt",
    "commandLanguage": "ESC_POS",
    "payloadType": "PRINT_INSTRUCTIONS",
    "copies": 1,
    "payload": {
      "width": 42,
      "instructions": [
        { "type": "text", "value": "MY STORE", "align": "center", "bold": true },
        { "type": "leftRight", "left": "Invoice", "right": "INV-1003" },
        { "type": "line" },
        { "type": "leftRight", "left": "Grand Total", "right": "1300.00", "bold": true },
        { "type": "blank", "lines": 1 },
        { "type": "barcode", "value": "INV1003", "symbology": "CODE128", "height": 80, "width": 2, "humanReadable": "below", "align": "center" },
        { "type": "blank", "lines": 1 },
        { "type": "qr", "value": "https://example.com/invoice/INV-1003", "size": 6, "errorCorrection": "M", "align": "center" },
        { "type": "feed", "lines": 4 },
        { "type": "cut" }
      ]
    }
  }'
```

Then inspect the `.prn` file the same way:

```powershell
Format-Hex C:\Temp\raw-printer-output.prn
```

You should see `1D 6B 49 ...` (`GS k` with CODE128's system code 73/0x49,
followed by a length byte and the `{B`-prefixed value) for the barcode,
and a run of `1D 28 6B ...` (`GS ( k`) commands for the QR code — select
model, module size, error correction, store data, then print.

**This only proves the command bytes are correct** — a file-redirected
Generic / Text Only printer cannot render or scan a barcode/QR image.
Confirming the barcode actually scans and the QR actually decodes
requires printing to real thermal hardware and testing with a barcode
scanner / phone camera.

#### PDF (a4-invoice)

Prints a caller-generated PDF (A4 invoice, delivery challan, report, ...)
to the printer mapped to `a4-invoice`. See
[Why PDF uses a separate path from raw ESC/POS](#why-pdf-uses-a-separate-path-from-raw-escpos)
for why this is a completely different code path from the ESC/POS flow
above — it does not reuse `sendRawToPrinter()`, and the raw print adapter
is never invoked for PDF.

##### Validation rules

- `jobId`, `printRole`, `commandLanguage`, `payloadType` are required (same
  envelope as `PRINT_INSTRUCTIONS`).
- `printRole` must be `"a4-invoice"`.
- `commandLanguage` must be `"PDF"`.
- `payloadType` must be `"PDF"`.
- `payloadEncoding` must be `"base64"`.
- `payload` is required and must be a non-empty base64 string.
- `copies` defaults to `1`, must be between 1 and 5.
- The decoded PDF must be non-empty.
- The decoded PDF must start with the PDF header bytes (`%PDF`).
- The decoded PDF must be under 10 MB.
- `a4-invoice` must have a saved printer mapping, that printer must still
  be installed, and the mapping's `commandLanguage` must be `"PDF"` —
  identical rules to the ESC/POS flow, just checked against the
  `a4-invoice` mapping instead of `receipt`.

##### Example request (PDF)

```bash
curl -X POST http://127.0.0.1:17777/print \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "INV-1001-A4",
    "printRole": "a4-invoice",
    "commandLanguage": "PDF",
    "payloadType": "PDF",
    "payloadEncoding": "base64",
    "copies": 1,
    "payload": "JVBERi0xLjQKJ..."
  }'
```

##### Example response (PDF)

```json
{
  "success": true,
  "jobId": "INV-1001-A4",
  "printRole": "a4-invoice",
  "commandLanguage": "PDF",
  "payloadType": "PDF",
  "printerName": "HP LaserJet",
  "copies": 1,
  "message": "PDF print job sent successfully"
}
```

##### SumatraPDF requirement

A normal A4 printer driver does not accept raw PDF bytes through
`WritePrinter` — PDF needs a PDF-rendering-aware tool in the loop. For this
MVP that tool is [SumatraPDF](https://www.sumatrapdfreader.org/), invoked
in silent mode with no UI:

```text
SumatraPDF.exe -print-to "HP LaserJet" -silent "C:\ProgramData\Pinnacle\PosPrintAgent\temp\print-INV-1001-A4-1700000000000.pdf"
```

Implemented in
[`src/pdf/pdf-print.service.ts`](src/pdf/pdf-print.service.ts) using
`execFile()` with an argument array (never a shell string), so printer
names/paths can never be interpreted as shell syntax. `copies` is
supported by invoking SumatraPDF once per copy.

**Expected location** (resolved by
[`src/pdf/pdf-tool-path.service.ts`](src/pdf/pdf-tool-path.service.ts), in
this order):

1. Beside `PosPrintAgent.exe`, in a packaged deployment.
2. `tools/SumatraPDF.exe` in the project root, during development
   (`npm run dev` or plain `node dist/main.js`).
3. An explicit override at `config.json`'s `sumatraPdfPath`, if set.

If none of these exist, `POST /print` returns `PDF_PRINT_TOOL_NOT_FOUND`
rather than silently opening the PDF in a browser/viewer or showing a print
dialog. This project does not download SumatraPDF automatically — see
[deployment/windows-service/README.md](deployment/windows-service/README.md#adding-sumatrapdfexe)
for how to obtain and place it.

##### Temp file behavior

Each PDF print job:

1. Decodes the base64 `payload`.
2. Validates the decoded bytes (header, size — see Validation rules above).
3. Writes them to `C:\ProgramData\Pinnacle\PosPrintAgent\temp\print-<sanitized-jobId>-<timestamp>.pdf`
   (`jobId` is sanitized to `[a-zA-Z0-9_-]` first, so it can't be used to
   escape the temp directory or produce an invalid filename).
4. Prints that file via SumatraPDF.
5. Deletes the temp file afterwards, best-effort — a deletion failure is
   logged as a warning but does **not** fail the response if printing
   already succeeded (see
   [`src/temp/temp-file.service.ts`](src/temp/temp-file.service.ts)).

##### Testing PDF printing

See
[deployment/windows-service/README.md](deployment/windows-service/README.md#verifying-pdf-printing)
for a full walkthrough (configure the `a4-invoice` mapping, send a request,
check the log line, confirm the temp file is cleaned up).

#### Error codes

All `POST /print` errors use the standard
`{ success: false, errorCode, message }` shape, shared across both payload
types:

| Error code                        | Used by               | Meaning                                                                                   |
| ---------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| `INVALID_PRINT_PAYLOAD`            | both                   | Request body, `payload.instructions`, or the PDF `payload` string failed basic validation. |
| `PRINT_ROLE_NOT_CONFIGURED`        | both                   | `printRole` has no saved printer mapping on this machine.                                  |
| `WINDOWS_PRINTER_NOT_FOUND`        | both                   | The mapped printer is no longer installed on this machine.                                 |
| `UNSUPPORTED_COMMAND_LANGUAGE`     | both                   | Requested `commandLanguage` doesn't match this role's configured mapping.                  |
| `UNSUPPORTED_PAYLOAD_TYPE`         | both                   | `payloadType` isn't `"PRINT_INSTRUCTIONS"` or `"PDF"` (e.g. `RAW_COMMAND`).                 |
| `PRINT_ROLE_NOT_IMPLEMENTED`       | both                   | This `printRole`/`payloadType` combination isn't implemented (e.g. PDF for `receipt`).      |
| `INSTRUCTION_TYPE_NOT_IMPLEMENTED` | PRINT_INSTRUCTIONS     | An instruction's `type` isn't one of `text`/`line`/`feed`/`cut`/`leftRight`/`blank`/`openDrawer`/`barcode`/`qr`. |
| `PRINT_QUEUE_FAILED`               | PRINT_INSTRUCTIONS     | Validation passed but the raw print adapter failed to deliver the rendered bytes.           |
| `UNSUPPORTED_PAYLOAD_ENCODING`     | PDF                    | `payloadEncoding` isn't `"base64"`.                                                         |
| `PDF_DECODE_FAILED`                | PDF                    | `payload` isn't valid base64.                                                               |
| `INVALID_PDF_PAYLOAD`              | PDF                    | Decoded payload is empty or doesn't start with the PDF header (`%PDF`).                     |
| `PDF_PAYLOAD_TOO_LARGE`            | PDF                    | Decoded PDF exceeds the 10 MB limit.                                                        |
| `PDF_PRINT_TOOL_NOT_FOUND`         | PDF                    | SumatraPDF.exe could not be found in any known location.                                    |
| `PDF_PRINT_FAILED`                 | PDF                    | SumatraPDF ran but exited with a failure.                                                   |
| `TEMP_FILE_WRITE_FAILED`           | PDF                    | Could not write the decoded PDF to the temp folder.                                        |

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

## Raw Printing Diagnostic

`POST /test-print` and `POST /diagnostics/raw-print` both send something to
a configured printer, but they exercise completely different Windows
printing paths, and they answer different questions. In short:

- `/test-print` checks basic Windows printer connectivity.
- `/diagnostics/raw-print` checks raw ESC_POS byte delivery.
- `/print` (see [above](#post-print)) accepts generic print instructions
  and converts them to ESC/POS internally, sending the result through the
  same raw adapter `/diagnostics/raw-print` uses.

| | `POST /test-print` | `POST /diagnostics/raw-print` |
| --- | --- | --- |
| Mechanism | PowerShell `Out-Printer` | PowerShell `Add-Type` compiling an inline C# `winspool.drv` P/Invoke helper (`OpenPrinter`/`StartDocPrinter`/`WritePrinter`), print job datatype `RAW` |
| Goes through | The normal Windows GDI print pipeline (the same path a Word document takes) | The spooler's raw datatype, bypassing GDI text rendering entirely |
| Proves | The agent can reach the printer and Windows can spool *a* job to it | Raw ESC_POS/TSPL/ZPL command bytes can be delivered to the printer largely unmodified |
| Cannot do | Send raw ESC_POS commands (paper cut, cash-drawer kick) — GDI text rendering does not pass control bytes through | Reliably work against printers/drivers that don't accept `RAW` datatype (see finding below) |
| Used for | The setup page's "Test Receipt/Barcode/A4/Cash Drawer" buttons | Local development/support diagnostics only |

Implementation:

- [`src/printers/raw-print.types.ts`](src/printers/raw-print.types.ts) — the
  `RawPrintRequest`/`RawPrintResult` contract.
- [`src/printers/raw-print.service.ts`](src/printers/raw-print.service.ts) —
  the only entry point callers may use (`sendRawToPrinter()`). Routes never
  call PowerShell or Windows APIs directly; they call this.
- [`src/printers/windows-print.service.ts`](src/printers/windows-print.service.ts) —
  isolated Windows implementation. If this approach doesn't hold up (see
  limitations below), it's the only file that needs to change; the
  `RawPrintRequest`/`RawPrintResult` contract and every caller stay the
  same.
- [`src/routes/diagnostics.routes.ts`](src/routes/diagnostics.routes.ts) —
  `POST /diagnostics/raw-print`, a temporary, local-only diagnostic route.
  **It must never be called by the web POS integration.**

### Trying it locally

```bash
curl -X POST http://127.0.0.1:17777/diagnostics/raw-print \
  -H "Content-Type: application/json" \
  -d '{"printRole": "receipt", "mode": "escpos-text"}'
```

`mode` must currently be `"escpos-text"` — the only mode this spike
implements. It builds a minimal ESC/POS buffer (initialize printer, print
`RAW PRINT TEST` and a timestamp, feed a few lines, full cut) and sends it
via the raw adapter to whatever printer is mapped to `printRole`.

Validated before sending, in this order:

- `printRole` is one of the [supported print roles](#supported-print-roles)
  (`400 INVALID_PRINT_ROLE`).
- `mode` is supported (`400 UNSUPPORTED_RAW_PRINT_MODE`).
- `printRole` has a saved mapping in config (`400 PRINT_ROLE_NOT_CONFIGURED`).
- the mapped printer is still installed, per a fresh `GET /printers`-style
  lookup (`400 PRINTER_NOT_FOUND`).
- the raw adapter itself succeeds (`502 RAW_PRINT_FAILED` if not — see next
  section).

### Known finding: spooler "success" does not mean the printer produced output

Testing this against this machine's `Microsoft Print to PDF` printer
surfaced a real limitation, not a hypothetical one. The sequence was:

1. `POST /diagnostics/raw-print` returned `{"success": true, ...}`.
2. Windows Event Viewer
   (`Applications and Services Logs → Microsoft → Windows → PrintService → Operational`)
   showed the job was actually rejected: *"A fatal error occurred while
   printing job ... The print filter pipeline process was terminated.
   Error information: 0x80070057."*
3. A 0-byte PDF file appeared in the user's `Documents` folder, named after
   the job — a placeholder Windows creates for a `PORTPROMPT:`-style port
   when nothing interactive is available to answer the "Save As" dialog,
   never actually written to because the print processor failed first.

The reason: `Microsoft Print to PDF` uses the `MS_XPS_PROC` print
processor, which only accepts XPS-formatted page data. Raw ESC_POS bytes
are not a valid input for it, so it fails downstream of the spooler.

The important part is *where* that failure happened: `WritePrinter` and
`EndDocPrinter` — the Win32 calls `sendRawViaWindowsSpooler()` makes — both
returned success. They only confirm the spooler *accepted the job into the
queue*; rendering happens asynchronously afterward, outside those calls, so
a downstream failure like this one is invisible to
`POST /diagnostics/raw-print`'s response. **A `success: true` response
means "the spooler accepted the raw bytes," not "the printer definitely
produced physical output."**

This is expected behavior for a GDI/XPS-based virtual printer, not a bug in
the raw adapter — `RAW` datatype is meant for real thermal/label printers
running ESC_POS/TSPL/ZPL (or a printer using the Windows "Generic / Text
Only" driver), which accept raw bytes as their native input. This machine
has no such printer attached, so end-to-end fidelity against real ESC/POS
hardware (does the paper actually cut? does the drawer actually kick?)
remains **unverified** — that's the next thing to test once real thermal
hardware is available, not something this spike could prove either way.

### Other known limitations of the PowerShell/P-Invoke approach

- `OpenPrinterA` is the ANSI Win32 entry point, so printer names with
  characters outside the current ANSI code page may not resolve correctly.
- This has only been exercised from an interactive user session. Running
  under a Windows Service account (WinSW, typically `LocalSystem`) may see
  a different printer list or different permissions — not yet validated.
- Each call pays a small `Add-Type` C# compile cost (sub-second on this
  machine, but not free, and not something you'd want on a hot path).

None of this required a native npm addon — the P/Invoke call is compiled
by PowerShell itself via `Add-Type`, which is the standard technique for
raw Windows printing from a script (the same approach behind the
long-standing "RawPrinterHelper" class from Microsoft KB 322091). If it
turns out not to hold up on real hardware, only
`windows-print.service.ts` needs to be replaced — the `RawPrintRequest`/
`RawPrintResult` contract in `raw-print.types.ts` and every caller of
`sendRawToPrinter()` stay the same.

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

| Method | Path                       | Description                                                                  |
| ------ | -------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/health`                  | Agent status, version, and per-role config state                             |
| GET    | `/printers`                | Windows printers currently installed on this machine                         |
| GET    | `/config`                  | Full current config for this machine                                         |
| POST   | `/config/printer-mappings` | Replace the printer mappings for this machine                                |
| GET    | `/setup`                   | Local HTML setup page (this agent's own UI, static files)                    |
| POST   | `/test-print`              | Send a test print to a role's configured printer                             |
| POST   | `/print`                   | Send a `PRINT_INSTRUCTIONS` (receipt/ESC_POS) or `PDF` (a4-invoice) print job |
| POST   | `/diagnostics/raw-print`   | Local-only diagnostic: send raw ESC_POS bytes to a role's configured printer |

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
- Copies the `/setup` page's static assets from `src/setup-ui`.
- Copies `SumatraPDF.exe` from `tools/SumatraPDF.exe` (project root) into
  the release folder, if present — see
  [SumatraPDF requirement](#sumatrapdf-requirement). This project does not
  download it automatically.
- Writes a support-person-oriented `release/PosPrintAgent/README.md`.
- Prints next steps, including a warning if `PosPrintAgent.exe`,
  `PosPrintAgentService.exe`, or `SumatraPDF.exe` are still missing from
  the folder (the `SumatraPDF.exe` warning is non-fatal — PDF printing just
  won't work at that counter until it's added).

Run both together with:

```bash
npm run release:win
```

After this, `release/PosPrintAgent` looks like:

```text
release/PosPrintAgent/
  PosPrintAgent.exe
  setup-ui/
  SumatraPDF.exe             <- only if tools/SumatraPDF.exe existed (see below)
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

Similarly, `SumatraPDF.exe` is a third-party binary this repo does not
build or download. Place a copy at `tools/SumatraPDF.exe` in the project
root before running `npm run prepare:release` and it's copied in
automatically; otherwise copy it into `release/PosPrintAgent` by hand
before deploying to a counter that prints A4 invoices.

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

## Current limitations

### Print instructions and rendering

- Only `printRole: "receipt"` with `commandLanguage: "ESC_POS"` and
  `payloadType: "PRINT_INSTRUCTIONS"` is implemented — see
  [POST /print](#post-print).
- `barcode-label` and `cash-drawer` are not implemented in `/print` yet;
  sending them returns `PRINT_ROLE_NOT_IMPLEMENTED`.
- `barcode` (`CODE128`/`EAN13` only) and `qr` instruction types are
  implemented, but ESC/POS barcode/QR command support and conventions
  (e.g. CODE128 code-set prefixing) vary across printer models — see
  [ESC/POS barcode command limitation](#escpos-barcode-command-limitation)
  and [ESC/POS QR command limitation](#escpos-qr-command-limitation).
  Real scannability has only been verified as correct command bytes
  against a file-redirected printer (see
  [Testing barcode and QR printing](#testing-barcode-and-qr-printing)),
  not against a physical scanner or thermal hardware. `image` and `table`
  instruction types, and TSPL/ZPL barcode-label printing, are not
  implemented. Sending any unimplemented instruction type returns
  `INSTRUCTION_TYPE_NOT_IMPLEMENTED`.
- Text encoding/code page handling is basic: the ESC/POS renderer only
  emits plain ASCII (`0x20`–`0x7E`) and silently replaces anything outside
  that range with `?`. No ESC/POS code-page-selection command is sent, so
  currency symbols, accented characters, and non-Latin scripts are not
  supported yet.
- Every `cut` instruction adds a small fixed safety feed (3 lines) before
  the cut bytes, on top of any explicit `feed` instructions already in the
  payload — this can produce more blank space than expected if a payload
  already fed generously before cutting.
- `openDrawer` sends a fixed, conservative ESC/POS drawer-kick pulse (see
  [ESC/POS drawer command limitation](#escpos-drawer-command-limitation))
  — it is not configurable per drawer/printer model yet, and whether it
  actually opens a physical drawer has not been verified against real
  drawer hardware.
- There is no separate `/cash-drawer/open` endpoint yet — opening the
  drawer outside of a receipt print job (e.g. a standalone "open drawer"
  button not tied to printing) isn't implemented; only the instruction-based
  `openDrawer` (as part of a `/print` job) is.
- Physical printer behavior (does the paper actually cut? does text render
  correctly at 58mm vs 80mm width? does `openDrawer` actually kick a real
  drawer?) still requires testing against real thermal hardware —
  everything so far has been verified against a Generic / Text Only
  printer redirected to a file (see
  [Testing with a Generic / Text Only printer mapped to a file](#testing-with-a-generic--text-only-printer-mapped-to-a-file)),
  not physical paper or a physical drawer.

### PDF (a4-invoice) printing

- Only `printRole: "a4-invoice"` with `commandLanguage: "PDF"` and
  `payloadType: "PDF"` is implemented — see [PDF (a4-invoice)](#pdf-a4-invoice).
  Other document-style roles are not implemented.
- Requires `SumatraPDF.exe` to be present (see
  [SumatraPDF requirement](#sumatrapdf-requirement)); there is intentionally
  no fallback to opening the PDF in a viewer or showing a print dialog.
- The agent does not generate, validate the *content* of, or otherwise
  understand the PDF beyond its header and size — layout, pagination, and
  correctness are entirely POS/backend's responsibility.
- Copies are implemented by invoking SumatraPDF once per copy, not via a
  single native "N copies" print option — for a small `copies` range (1–5)
  this is simple and reliable, but it is not the most efficient approach
  for larger print runs.
- Network printer behavior under a Windows service account is unverified —
  see [deployment/windows-service/README.md](deployment/windows-service/README.md#troubleshooting-service-account-printer-access-issues).
  Local USB printers are the primary MVP target.
- Only tested so far via a real Windows print pipeline in general; PDF
  printing specifically still needs verification against SumatraPDF once a
  copy of it and a real (or virtual) A4 printer are available in this
  environment.

### Everything else

- Cash drawer endpoint (`POST /cash-drawer/open`) — `POST /test-print` can
  send a text page to the printer feeding a drawer, but it does not send
  the raw ESC_POS kick command that actually opens one.
- An endpoint to set `machineCode` at runtime (must still be edited by hand
  in `config.json`; the setup page shows it read-only for this reason).
- Authentication/signing of requests from the web POS.
- Structured/rotating log files (current logger is a flat append-only file).
