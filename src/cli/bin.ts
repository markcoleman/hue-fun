#!/usr/bin/env node

import { runHueCli } from "./app";

const exitCode = await runHueCli();
if (exitCode !== 0) {
  process.exitCode = exitCode;
}
