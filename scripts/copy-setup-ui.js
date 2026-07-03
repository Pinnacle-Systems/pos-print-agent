"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.resolve(__dirname, "..", "src", "setup-ui");
const DEST_DIR = path.resolve(__dirname, "..", "dist", "setup-ui");

function main() {
  fs.cpSync(SRC_DIR, DEST_DIR, { recursive: true });
  console.log(`Copied setup UI assets to ${DEST_DIR}`);
}

main();
