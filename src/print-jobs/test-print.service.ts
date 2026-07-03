import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { AppError } from "../errors/app-error";
import { getConfig } from "../config/config.service";
import { logger } from "../logging/logger";
import type { PrintRole } from "./print-role";

const execFileAsync = promisify(execFile);

export interface TestPrintResult {
  role: PrintRole;
  printerName: string;
}

// Consumers only ever call sendTestPrint() below. The concrete mechanism is
// swappable behind this interface, same pattern as
// printer-discovery.service.ts, in case raw ESC_POS/TSPL passthrough
// printing replaces this later.
interface TestPrintProvider {
  print(printerName: string, content: string): Promise<void>;
}

/**
 * Sends a short text job to the printer through PowerShell's `Out-Printer`
 * cmdlet, the same "shell out to a tool already on every Windows machine"
 * approach used by printer discovery. This is a connectivity/wiring smoke
 * test, not raw ESC_POS/TSPL/ZPL byte printing: it proves the agent can
 * reach the configured printer and Windows can spool a job to it, which is
 * what the setup page's test-print buttons are for. Real receipt/label
 * rendering and the cash-drawer kick command are separate, not-yet-built
 * features (see README "What is intentionally not implemented yet").
 */
class WindowsTestPrintProvider implements TestPrintProvider {
  async print(printerName: string, content: string): Promise<void> {
    const tempFile = path.join(os.tmpdir(), `pos-print-agent-test-${Date.now()}-${process.pid}.txt`);
    const escapedPrinterName = printerName.replace(/'/g, "''");
    const escapedTempFile = tempFile.replace(/'/g, "''");
    const command = `Get-Content -LiteralPath '${escapedTempFile}' | Out-Printer -Name '${escapedPrinterName}'`;

    fs.writeFileSync(tempFile, content, "utf-8");

    try {
      await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
        windowsHide: true,
        timeout: 15_000,
      });
    } finally {
      fs.promises.rm(tempFile, { force: true }).catch((err) => {
        logger.warn(`Failed to clean up temp test print file ${tempFile}: ${err.message}`);
      });
    }
  }
}

class DevMockTestPrintProvider implements TestPrintProvider {
  async print(): Promise<void> {
    // No real print spooler to talk to outside Windows; treat as a no-op
    // success so the rest of the flow (route wiring, UI) can still be
    // exercised locally.
  }
}

function getTestPrintProvider(): TestPrintProvider {
  return process.platform === "win32" ? new WindowsTestPrintProvider() : new DevMockTestPrintProvider();
}

function buildTestPrintContent(role: PrintRole, printerName: string): string {
  const timestamp = new Date().toISOString();
  return [
    "Pinnacle POS Print Agent - Test Print",
    `Role: ${role}`,
    `Printer: ${printerName}`,
    `Time: ${timestamp}`,
    "",
    "If you can read this, the agent can reach this printer.",
  ].join("\r\n");
}

export async function sendTestPrint(role: PrintRole): Promise<TestPrintResult> {
  const config = getConfig();
  const mapping = config.printerMappings[role];

  if (!mapping) {
    throw new AppError(
      400,
      "PRINT_ROLE_NOT_CONFIGURED",
      `No printer is configured for role "${role}". Configure and save it on the setup page first.`,
    );
  }

  const provider = getTestPrintProvider();
  const content = buildTestPrintContent(role, mapping.windowsPrinterName);

  try {
    await provider.print(mapping.windowsPrinterName, content);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new AppError(
      502,
      "TEST_PRINT_FAILED",
      `Unable to send test print to "${mapping.windowsPrinterName}": ${message}`,
    );
  }

  return { role, printerName: mapping.windowsPrinterName };
}
