import fs from "node:fs";
import path from "node:path";

export interface BuildInfo {
  version: string;
  buildTime: string;
}

// Captured once at module load - used as the buildTime fallback when no
// generated build-info.json is available yet (e.g. `npm run dev` before
// any build has run). See "Build time can come from generated build-info
// file or fallback to process start time" in the release-hardening prompt.
const PROCESS_START_TIME = new Date().toISOString();

// scripts/generate-build-info.js writes dist/build-info.json during `npm
// run build`, and scripts/prepare-windows-release.js copies it beside
// PosPrintAgent.exe - same "copied beside the exe, read from real disk"
// pattern already used for the /setup static assets (see
// resolveSetupUiDir() in routes/setup.routes.ts), because pkg's virtual
// snapshot filesystem is not a reliable place to read generated files from.
function resolveBuildInfoPath(): string {
  const isPackaged = Boolean((process as unknown as { pkg?: unknown }).pkg);
  if (isPackaged) {
    return path.join(path.dirname(process.execPath), "build-info.json");
  }
  return path.join(__dirname, "..", "build-info.json");
}

// __dirname is "src" in dev (tsx) and "dist" after `tsc` - both are direct
// children of the project root, so one ".." reaches package.json in either
// case without needing to special-case dev vs. built.
function readPackageJsonVersion(): string {
  try {
    const packageJsonPath = path.join(__dirname, "..", "package.json");
    const raw = fs.readFileSync(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function loadBuildInfo(): BuildInfo {
  try {
    const raw = fs.readFileSync(resolveBuildInfoPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<BuildInfo>;
    if (typeof parsed.version === "string" && typeof parsed.buildTime === "string") {
      return { version: parsed.version, buildTime: parsed.buildTime };
    }
  } catch {
    // Not present yet (e.g. `npm run dev` before any build, or a release
    // folder assembled without running the build-info generation step) -
    // fall back below rather than failing to start.
  }
  return { version: readPackageJsonVersion(), buildTime: PROCESS_START_TIME };
}

export const BUILD_INFO: BuildInfo = loadBuildInfo();
