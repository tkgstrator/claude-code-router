#!/usr/bin/env bun

import { join } from "path";
import { existsSync, mkdirSync } from "fs";

console.log("Building Shared package...");

const sharedDir = join(import.meta.dir, "../packages/shared");
const distDir = join(sharedDir, "dist");

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

console.log("Generating type declaration files...");
const tscResult = Bun.spawnSync(
  ["bun", "x", "tsc", "--emitDeclarationOnly", "--declaration", "--outDir", distDir],
  { cwd: sharedDir, stdout: "inherit", stderr: "inherit", stdin: "inherit" }
);
if (tscResult.exitCode !== 0) {
  console.error("tsc failed");
  process.exit(1);
}

console.log("Building shared package...");
const result = await Bun.build({
  entrypoints: [join(sharedDir, "src/index.ts")],
  outdir: distDir,
  naming: "index.js",
  minify: true,
  target: "bun",
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}

console.log("Shared package build completed successfully!");
