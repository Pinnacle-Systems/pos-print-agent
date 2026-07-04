import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Sends bytes to a Windows print queue using the RAW datatype via the
// winspool.drv OpenPrinter/StartDocPrinter/WritePrinter functions, so the
// spooler delivers the exact bytes we hand it instead of running them
// through the GDI text pipeline (which is what `Out-Printer`, used by
// POST /test-print, does - and why it can't be used for ESC/POS, TSPL, or
// ZPL command bytes).
//
// There is no Node-native way to call winspool.drv without a native npm
// addon (out of scope per project convention - see
// printer-discovery.service.ts). Instead this compiles a small inline C#
// P/Invoke helper via PowerShell's `Add-Type` and invokes it, the same
// "shell out to a tool already on every Windows machine" approach used
// elsewhere in this codebase. This is a well-established technique (the
// same one behind the classic "RawPrinterHelper" class from Microsoft KB
// 322091), not a hack specific to this project.
//
// Known limitations of this approach (documented in README.md under "Raw
// Printing Diagnostic"):
//   - OpenPrinterA is the ANSI entry point, so printer names outside the
//     current ANSI code page may not resolve correctly.
//   - Running under a Windows Service account (e.g. via WinSW, LocalSystem)
//     may see a different set of printers / permissions than the
//     interactive user who installed them; this hasn't been validated
//     under a service account yet.
//   - Each call pays a small `Add-Type` C# compile cost (well under a
//     second on a modern machine, but not free).
// If any of these prove unworkable on real hardware, swap the
// implementation behind sendRawViaWindowsSpooler() - raw-print.service.ts
// and its RawPrintRequest/RawPrintResult contract do not need to change.
const RAW_PRINT_POWERSHELL_SCRIPT = `param(
    [Parameter(Mandatory=$true)][string]$PrinterName,
    [Parameter(Mandatory=$true)][string]$DataFile,
    [Parameter(Mandatory=$true)][string]$JobName
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class PosPrintAgentRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static void SendBytesToPrinter(string printerName, byte[] bytes, string jobName)
    {
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = jobName;
        di.pDataType = "RAW";

        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
        {
            throw new Exception("OpenPrinter failed with Win32 error " + Marshal.GetLastWin32Error());
        }

        try
        {
            if (!StartDocPrinter(hPrinter, 1, di))
            {
                throw new Exception("StartDocPrinter failed with Win32 error " + Marshal.GetLastWin32Error());
            }

            try
            {
                if (!StartPagePrinter(hPrinter))
                {
                    throw new Exception("StartPagePrinter failed with Win32 error " + Marshal.GetLastWin32Error());
                }

                IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                try
                {
                    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                    int written;
                    if (!WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written))
                    {
                        throw new Exception("WritePrinter failed with Win32 error " + Marshal.GetLastWin32Error());
                    }
                }
                finally
                {
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                }

                EndPagePrinter(hPrinter);
            }
            finally
            {
                EndDocPrinter(hPrinter);
            }
        }
        finally
        {
            ClosePrinter(hPrinter);
        }
    }
}
"@

$bytes = [System.IO.File]::ReadAllBytes($DataFile)
[PosPrintAgentRawPrinter]::SendBytesToPrinter($PrinterName, $bytes, $JobName)
`;

export async function sendRawViaWindowsSpooler(printerName: string, jobName: string, data: Buffer): Promise<void> {
  const stamp = `${Date.now()}-${process.pid}`;
  const dataFile = path.join(os.tmpdir(), `pos-print-agent-raw-${stamp}.bin`);
  const scriptFile = path.join(os.tmpdir(), `pos-print-agent-raw-${stamp}.ps1`);

  fs.writeFileSync(dataFile, data);
  fs.writeFileSync(scriptFile, RAW_PRINT_POWERSHELL_SCRIPT, "utf-8");

  try {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptFile,
        "-PrinterName",
        printerName,
        "-DataFile",
        dataFile,
        "-JobName",
        jobName,
      ],
      { windowsHide: true, timeout: 20_000 },
    );
  } finally {
    fs.promises.rm(dataFile, { force: true }).catch(() => {});
    fs.promises.rm(scriptFile, { force: true }).catch(() => {});
  }
}
