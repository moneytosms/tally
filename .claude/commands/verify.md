# /verify

Run the verification suite for tally. Read-only, headless.

## Steps

1. `pnpm typecheck` (tsc --noEmit)
2. `pnpm lint` (eslint .)
3. `pnpm format` (prettier --check, no writes)
4. `CI=1 pnpm test` (vitest run, single pass, no watch)

## Pass criteria

- All four steps exit 0. Lint warnings are allowed; errors are not.

## On failure

- Report the failing step and its first errors.
- Fix in place, then rerun only the failed step.
- Do not run `pnpm format:write` or `eslint --fix` as part of /verify.
