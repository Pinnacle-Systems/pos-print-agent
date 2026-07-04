import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config/config.service";

const SUMATRA_EXE_NAME = "SumatraPDF.exe";

function isPackaged(): boolean {
  return Boolean((process as unknown as { pkg?: unknown }).pkg);
}

// Beside PosPrintAgent.exe - see scripts/prepare-windows-release.js, which
// copies tools/SumatraPDF.exe into the release folder next to the exe.
function packagedCandidatePath(): string {
  return path.join(path.dirname(process.execPath), SUMATRA_EXE_NAME);
}

// <project root>/tools/SumatraPDF.exe. Two directories up from this file
// works whether it's running as src/pdf (tsx dev) or dist/pdf (`node
// dist/main.js` without pkg packaging) - both sit at the same depth under
// the project root.
function devCandidatePath(): string {
  return path.join(__dirname, "..", "..", "tools", SUMATRA_EXE_NAME);
}

function configuredCandidatePath(): string | undefined {
  const configured = getConfig().sumatraPdfPath;
  return configured && configured.trim().length > 0 ? configured : undefined;
}

/**
 * Resolves SumatraPDF.exe's location using a fixed lookup order (see README
 * "SumatraPDF requirement"):
 *   1. Beside PosPrintAgent.exe, when running as a packaged exe.
 *   2. <project root>/tools/SumatraPDF.exe, in development.
 *   3. An explicit override at config.json's `sumatraPdfPath`, if set.
 * Returns undefined if none of these exist. Callers must surface
 * PDF_PRINT_TOOL_NOT_FOUND rather than silently falling back to any other
 * PDF viewer or opening the file interactively.
 */
export function resolveSumatraPdfPath(): string | undefined {
  const candidates = [isPackaged() ? packagedCandidatePath() : devCandidatePath()];

  const configured = configuredCandidatePath();
  if (configured) {
    candidates.push(configured);
  }

  return candidates.find((candidate) => fs.existsSync(candidate));
}
