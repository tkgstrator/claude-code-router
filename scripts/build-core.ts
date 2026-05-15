#!/usr/bin/env bun

import { join } from "path";

console.log("Building Core package (@musistudio/llms)...");

const coreDir = join(import.meta.dir, "../packages/core");

const result = Bun.spawnSync(["bun", "run", "build"], {
  stdout: "inherit", stderr: "inherit", stdin: "inherit",
  cwd: coreDir,
});

if (result.exitCode !== 0) {
  console.error("Core package build failed");
  process.exit(1);
}

console.log("Core package build completed successfully!");
