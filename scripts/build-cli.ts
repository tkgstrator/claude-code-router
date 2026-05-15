#!/usr/bin/env bun

import { join } from "path";
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, rmSync, cpSync } from "fs";

console.log("Building CLI package...");

const rootDir = join(import.meta.dir, "..");
const sharedDir = join(rootDir, "packages/shared");
const cliDir = join(rootDir, "packages/cli");
const serverDir = join(rootDir, "packages/server");
const uiDir = join(rootDir, "packages/ui");

// Step 0: Ensure shared package is built first
const sharedDistDir = join(sharedDir, "dist");
if (!existsSync(sharedDistDir) || !existsSync(join(sharedDistDir, "index.js"))) {
  console.log("Shared package not found, building it first...");
  const r = Bun.spawnSync(["bun", "run", "../../scripts/build-shared.ts"], {
    stdout: "inherit", stderr: "inherit", stdin: "inherit",
    cwd: rootDir,
  });
  if (r.exitCode !== 0) process.exit(1);
}

// Step 1: Build Server package
console.log("Building Server package...");
const serverResult = Bun.spawnSync(["bun", "run", "scripts/build-server.ts"], {
  stdout: "inherit", stderr: "inherit", stdin: "inherit",
  cwd: rootDir,
});
if (serverResult.exitCode !== 0) process.exit(1);

// Step 2: Build UI package
console.log("Building UI package...");
const uiResult = Bun.spawnSync(["bun", "run", "build"], {
  stdout: "inherit", stderr: "inherit", stdin: "inherit",
  cwd: uiDir,
});
if (uiResult.exitCode !== 0) process.exit(1);

// Step 3: Create CLI dist directory
const cliDistDir = join(cliDir, "dist");
if (!existsSync(cliDistDir)) {
  mkdirSync(cliDistDir, { recursive: true });
}

// Step 4: Build CLI application
console.log("Building CLI application...");
const cliResult = await Bun.build({
  entrypoints: [join(cliDir, "src/cli.ts")],
  outdir: cliDistDir,
  naming: "cli.js",
  minify: true,
  target: "bun",
});
if (!cliResult.success) {
  console.error("CLI build failed:", cliResult.logs);
  process.exit(1);
}

// Step 5: Copy tiktoken WASM
console.log("Copying tiktoken_bg.wasm from server to CLI dist...");
const tiktokenSource = join(serverDir, "dist/tiktoken_bg.wasm");
const tiktokenDest = join(cliDistDir, "tiktoken_bg.wasm");
if (existsSync(tiktokenSource)) {
  copyFileSync(tiktokenSource, tiktokenDest);
  console.log("tiktoken_bg.wasm copied successfully!");
} else {
  console.warn("Warning: tiktoken_bg.wasm not found in server dist, skipping...");
}

// Step 6: Copy UI index.html
console.log("Copying index.html from UI to CLI dist...");
const uiSource = join(uiDir, "dist/index.html");
const uiDest = join(cliDistDir, "index.html");
if (existsSync(uiSource)) {
  copyFileSync(uiSource, uiDest);
  console.log("index.html copied successfully!");
} else {
  console.warn("Warning: index.html not found in UI dist, skipping...");
}

// Step 7: Copy CLI dist to project root
console.log("\nCopying CLI dist to project root...");
const rootDistDir = join(rootDir, "dist");
if (existsSync(rootDistDir)) {
  rmSync(rootDistDir, { recursive: true, force: true });
}
cpSync(cliDistDir, rootDistDir, { recursive: true });
console.log("CLI dist copied to project root successfully!");

console.log("\nCLI build completed successfully!");
console.log("\nCLI dist contents:");
for (const file of readdirSync(cliDistDir)) {
  const size = (statSync(join(cliDistDir, file)).size / 1024 / 1024).toFixed(2);
  console.log(`  - ${file} (${size} MB)`);
}
