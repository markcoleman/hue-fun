import { runHueCli } from "./app";

void runHueCli().then((exitCode) => {
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
});
