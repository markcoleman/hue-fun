#!/usr/bin/env node

import { runHueCli } from "../cli/app";

const exitCode = await runHueCli(["mcp", ...process.argv.slice(2)]);
if (exitCode !== 0) {
  process.exitCode = exitCode;
}
