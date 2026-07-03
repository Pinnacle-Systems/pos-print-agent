import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "../errors/app-error";

const execFileAsync = promisify(execFile);

export interface DiscoveredPrinter {
  name: string;
  isDefault: boolean;
}

// Consumers (routes, printer-validation.service) only ever call listPrinters()
// below. The concrete lookup mechanism is swappable behind this interface in
// case the Windows approach needs to change after exe packaging / service
// installation is tested on real hardware.
interface PrinterDiscoveryProvider {
  listPrinters(): Promise<DiscoveredPrinter[]>;
}

const DEV_MOCK_PRINTERS: DiscoveredPrinter[] = [
  { name: "EPSON TM-T82X Receipt", isDefault: true },
  { name: "TSC TE244", isDefault: false },
  { name: "Microsoft Print to PDF", isDefault: false },
];

/**
 * Lists installed printers via WMI's Win32_Printer class through
 * powershell.exe. This shells out to a tool already present on every
 * Windows machine instead of depending on a native npm addon, which keeps
 * it working after exe packaging (pkg) without native module rebuild
 * issues.
 */
class WindowsPrinterDiscoveryProvider implements PrinterDiscoveryProvider {
  async listPrinters(): Promise<DiscoveredPrinter[]> {
    const command =
      "Get-CimInstance -ClassName Win32_Printer | Select-Object Name, Default | ConvertTo-Json -Compress";

    let stdout: string;
    try {
      const result = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { windowsHide: true, timeout: 10_000 },
      );
      stdout = result.stdout;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new AppError(502, "PRINTER_DISCOVERY_FAILED", `Unable to list Windows printers: ${message}`);
    }

    return parsePrinterListOutput(stdout);
  }
}

class DevMockPrinterDiscoveryProvider implements PrinterDiscoveryProvider {
  async listPrinters(): Promise<DiscoveredPrinter[]> {
    return DEV_MOCK_PRINTERS;
  }
}

function parsePrinterListOutput(stdout: string): DiscoveredPrinter[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new AppError(502, "PRINTER_DISCOVERY_FAILED", "Unable to parse Windows printer list output");
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows
    .filter((row): row is { Name: string; Default?: boolean } => {
      return typeof row === "object" && row !== null && typeof (row as { Name?: unknown }).Name === "string";
    })
    .map((row) => ({ name: row.Name, isDefault: Boolean(row.Default) }));
}

function getPrinterDiscoveryProvider(): PrinterDiscoveryProvider {
  // Lets the API respond with something usable during local development on
  // a non-Windows machine, where there is no Windows print spooler to query.
  return process.platform === "win32" ? new WindowsPrinterDiscoveryProvider() : new DevMockPrinterDiscoveryProvider();
}

export async function listPrinters(): Promise<DiscoveredPrinter[]> {
  const provider = getPrinterDiscoveryProvider();
  return provider.listPrinters();
}
