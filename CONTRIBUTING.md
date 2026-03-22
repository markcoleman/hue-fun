# Contributing

Thanks for improving OpenHue Client.

## Fast path

```bash
npm install
npm run validate
```

`npm run validate` runs the repo's default safety rail in the same order expected by CI:

1. generated SDK drift check
2. TypeScript typecheck
3. unit tests
4. production build

## Source of truth and boundaries

- `openhue.yaml` is the wire-contract source of truth.
- `src/generated` is machine-generated output. Do not edit it by hand.
- `src/client.ts` is the main ergonomic public API surface.
- `src/internal/*` contains reusable runtime helpers.
- `test/unit/*` is the deterministic default test suite.
- `scripts/harness.ts` is for real-bridge validation only.

## Safe change workflow

### When the OpenAPI contract changed

```bash
npm run generate
npm run validate
```

Then review the generated diff in `src/generated` before shipping.

### When only handwritten behavior changed

1. Prefer small, composable helpers over large inline branches.
2. Keep public namespaces consistent: `lights`, `groupedLights`, `scenes`, and `events`.
3. Add or update unit coverage in `test/unit` for the affected behavior.
4. Run `npm run validate` before committing.

## Developer-experience checklist

Before opening a PR, check that your change keeps the repo easy to work in:

- **AI-friendly:** update docs or prompt playbooks if the expected workflow changed.
- **Low cognitive load:** prefer extracting repeated patterns into named helpers.
- **Clean repo:** avoid unrelated generated churn or dead files.
- **Tests first-class:** add deterministic unit tests for behavior changes.
- **SOLID-ish direction:** keep transport, serialization, and user-facing workflows separated.

## Harness safety

The harness must stay safe by default.

- Read-only commands can run without extra confirmation.
- State-changing bridge commands must stay guarded by `--write`.
- Live bridge checks belong in the harness or manual smoke tests, not the unit suite.

## Good prompts for coding agents

- “Add a high-level helper using an existing generated operation, add unit tests, and run `npm run validate`.”
- “Refactor repeated client logic into small helpers without editing `src/generated`.”
- “Regenerate from `openhue.yaml`, review drift, and keep the handwritten layer aligned.”
