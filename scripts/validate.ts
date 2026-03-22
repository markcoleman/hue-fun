import { spawn } from "node:child_process";

const VALIDATION_STEPS = [
  { label: "Generated SDK drift", command: "npm", args: ["run", "generate:check"] },
  { label: "TypeScript", command: "npm", args: ["run", "typecheck"] },
  { label: "Unit tests", command: "npm", args: ["test"] },
  { label: "Build", command: "npm", args: ["run", "build"] },
] as const;

type ValidationStep = (typeof VALIDATION_STEPS)[number];

async function runStep(step: ValidationStep): Promise<void> {
  process.stdout.write(`\n▶ ${step.label}: ${step.command} ${step.args.join(" ")}\n`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: process.cwd(),
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(signal ? `Validation interrupted by signal ${signal}` : `Validation failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function main(): Promise<void> {
  const startedAt = Date.now();

  for (const step of VALIDATION_STEPS) {
    await runStep(step);
  }

  const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  process.stdout.write(`\n✅ Validation completed in ${durationSeconds}s\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n❌ ${message}\n`);
  process.exitCode = 1;
});
