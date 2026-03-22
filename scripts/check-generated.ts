import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const root = process.cwd();
const expectedDir = join(root, "src/generated");
const openapiCli = join(root, "node_modules/.bin", process.platform === "win32" ? "openapi-ts.cmd" : "openapi-ts");

async function listFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(rootDir, fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath.slice(rootDir.length + 1));
    }
  }

  return files.sort();
}

async function compareDirectories(actualDir: string, generatedDir: string): Promise<string[]> {
  const [actualFiles, generatedFiles] = await Promise.all([listFiles(actualDir), listFiles(generatedDir)]);
  const mismatches: string[] = [];
  const fileSet = new Set([...actualFiles, ...generatedFiles]);

  for (const file of [...fileSet].sort()) {
    if (!actualFiles.includes(file)) {
      mismatches.push(`Missing committed file: ${file}`);
      continue;
    }
    if (!generatedFiles.includes(file)) {
      mismatches.push(`Unexpected committed file: ${file}`);
      continue;
    }

    const [actualContent, generatedContent] = await Promise.all([
      readFile(join(actualDir, file), "utf8"),
      readFile(join(generatedDir, file), "utf8"),
    ]);

    if (actualContent !== generatedContent) {
      mismatches.push(`Changed generated file: ${file}`);
    }
  }

  return mismatches;
}

async function run(): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "newhue-generated-"));

  await new Promise<void>((resolve, reject) => {
    const child = spawn(openapiCli, ["-i", "openhue.yaml", "-o", tempDir, "-c", "@hey-api/client-fetch"], {
      cwd: root,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`openapi-ts exited with code ${code ?? "unknown"}`));
    });
  });

  const mismatches = await compareDirectories(expectedDir, tempDir);
  if (mismatches.length > 0) {
    console.error("Generated sources are out of date.");
    for (const mismatch of mismatches) {
      console.error(`- ${mismatch}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Generated sources are up to date.");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
