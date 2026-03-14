# AGENTS.md

## Repo Map

- `openhue.yaml`: source OpenAPI specification
- `src/generated`: generated SDK output from `npm run generate`
- `src/client.ts`: handwritten ergonomic client layer and helper methods
- `src/internal`: runtime utilities such as error handling and SSE parsing
- `scripts/harness.ts`: manual bridge validation CLI
- `scripts/check-generated.ts`: generator drift checker used by CI
- `test/unit`: deterministic unit tests
- `docs`: human-facing guides and agent playbooks

## Rules

- Do not edit `src/generated` by hand. Regenerate it from `openhue.yaml`.
- Prefer extending `src/client.ts` and `src/internal/*` for behavior changes.
- Keep bridge-side validation behind the harness or manual workflows, not the default unit suite.
- Keep write operations in the harness guarded by `--write`.

## Commands

```bash
npm run generate
npm run generate:check
npm run typecheck
npm test
npm run build
npm run docs
npm run harness -- discover
```

## Safe Extension Workflow

1. Update `openhue.yaml` if the wire contract changed.
2. Regenerate the SDK with `npm run generate`.
3. Adjust handwritten wrappers in `src/client.ts`.
4. Add or update Vitest coverage.
5. Run `npm run generate:check && npm run typecheck && npm test && npm run build`.
