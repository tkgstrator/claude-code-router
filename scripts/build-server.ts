#!/usr/bin/env bun

import { join } from "path";
import { existsSync, mkdirSync, copyFileSync } from "fs";

console.log("Building Server package...");

const serverDir = join(import.meta.dir, "../packages/server");
const distDir = join(serverDir, "dist");

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

console.log("Generating type declaration files...");
const tscResult = Bun.spawnSync(
  ["bun", "x", "tsc", "--emitDeclarationOnly", "--declaration", "--outDir", distDir],
  { cwd: serverDir, stdout: "inherit", stderr: "inherit" }
);
if (tscResult.exitCode !== 0) {
  console.error("tsc failed");
  process.exit(1);
}

console.log("Building server application...");
const result = await Bun.build({
  entrypoints: [join(serverDir, "src/index.ts")],
  outdir: distDir,
  naming: "index.js",
  minify: true,
  target: "bun",
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}

console.log("Copying tiktoken WASM file...");
const tiktokenSource = join(serverDir, "node_modules/tiktoken/tiktoken_bg.wasm");
const tiktokenDest = join(distDir, "tiktoken_bg.wasm");

if (existsSync(tiktokenSource)) {
  copyFileSync(tiktokenSource, tiktokenDest);
  console.log("Tiktoken WASM file copied successfully!");
} else {
  console.warn("Warning: tiktoken_bg.wasm not found, skipping...");
}

console.log("Server build completed successfully!");
