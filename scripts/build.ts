#!/usr/bin/env bun

import { join } from "path";

console.log("Building Claude Code Router (Monorepo)...");

const rootDir = join(import.meta.dir, "..");

function run(script: string) {
  const result = Bun.spawnSync(["bun", "run", script], {
    stdout: "inherit", stderr: "inherit", stdin: "inherit",
    cwd: rootDir,
  });
  if (result.exitCode !== 0) {
    console.error(`Failed: ${script}`);
    process.exit(1);
  }
}

console.log("Building core package (@musistudio/llms)...");
run("scripts/build-core.ts");

console.log("Building shared package...");
run("scripts/build-shared.ts");

console.log("Building CLI package (includes server and ui)...");
run("scripts/build-cli.ts");

console.log("\nBuild completed successfully!");
console.log("\nArtifacts are available in packages/*/dist:");
console.log("  - packages/core/dist/     (Core package: @musistudio/llms)");
console.log("  - packages/shared/dist/   (Shared package)");
console.log("  - packages/cli/dist/      (CLI + UI + tiktoken)");
console.log("  - packages/server/dist/   (Server standalone)");
console.log("  - packages/ui/dist/       (UI standalone)");
