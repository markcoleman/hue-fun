# GitHub Copilot Instructions

This repository contains a generated Philips Hue CLIP v2 SDK plus a handwritten helper layer.

## Required workflow

- Treat `openhue.yaml` as the source of truth.
- Never hand-edit files in `src/generated`.
- Implement product behavior in `src/client.ts` and `src/internal/*`.
- Add or update unit coverage in `test/unit` for every behavior change.
- Run `npm run generate:check`, `npm run typecheck`, `npm test`, and `npm run build` before considering a change complete.

## Repo-specific guidance

- Use the existing high-level namespaces: `lights`, `groupedLights`, `scenes`, and `events`.
- Preserve typed error behavior: `HueHttpError`, `HueApiError`, `HueAuthError`, and `HueLinkButtonNotPressedError`.
- Keep the harness safe by default; state-changing commands must require `--write`.

## Dependency Updates

- Keep `package.json` and `package-lock.json` in sync.
- If an OpenAPI generator dependency changes behavior, regenerate `src/generated` and verify the drift check still passes.
- Dependabot PRs should stay small and mechanical unless a dependency upgrade requires code changes.
- When adding a new dependency ecosystem or workflow manager, update `.github/dependabot.yml` so automated updates keep covering it.
