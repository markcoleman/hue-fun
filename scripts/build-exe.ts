import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SEA_BLOB_NAME = "NODE_SEA_BLOB";
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function parseArgs(argv: string[]): { output?: string } {
  const outputIndex = argv.indexOf("--output");
  if (outputIndex === -1) {
    return {};
  }

  return { output: argv[outputIndex + 1] };
}

function resolveOutputPath(rootDir: string, requested?: string): string {
  if (requested) {
    return resolve(rootDir, requested);
  }

  const extension = process.platform === "win32" ? ".exe" : "";
  return resolve(rootDir, "build", `hue-${process.platform}-${process.arch}${extension}`);
}

function makePostjectArgs(executablePath: string, seaBlobPath: string): string[] {
  const args = [executablePath, SEA_BLOB_NAME, seaBlobPath, "--sentinel-fuse", SEA_FUSE];
  if (process.platform === "darwin") {
    args.push("--macho-segment-name", "NODE_SEA");
  }
  return args;
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const distEntry = resolve(rootDir, "dist", "hue-sea.cjs");
  if (!existsSync(distEntry)) {
    throw new Error("Missing dist/hue-sea.cjs. Run `npm run build` first.");
  }

  const buildDir = resolve(rootDir, "build");
  mkdirSync(buildDir, { recursive: true });

  const outputPath = resolveOutputPath(rootDir, parseArgs(process.argv.slice(2)).output);
  const seaBlobPath = resolve(buildDir, "hue.blob");
  const seaConfigPath = resolve(buildDir, "sea-config.json");
  const postjectPath = resolve(
    rootDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "postject.cmd" : "postject",
  );

  writeFileSync(
    seaConfigPath,
    JSON.stringify(
      {
        disableExperimentalSEAWarning: true,
        main: distEntry,
        output: seaBlobPath,
        useCodeCache: false,
      },
      null,
      2,
    ),
    "utf8",
  );

  execFileSync(process.execPath, ["--experimental-sea-config", seaConfigPath], { stdio: "inherit" });
  copyFileSync(process.execPath, outputPath);
  if (process.platform !== "win32") {
    chmodSync(outputPath, 0o755);
  }

  execFileSync(postjectPath, makePostjectArgs(outputPath, seaBlobPath), { stdio: "inherit" });

  if (process.platform === "darwin") {
    try {
      execFileSync("codesign", ["--sign", "-", outputPath], { stdio: "inherit" });
    } catch (error) {
      console.warn(`codesign skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`Created self-contained executable: ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
