## Checkpoint 2026-11-12 03:18
Status: done
In progress: nothing. UX + trust rework is complete and verified on branch `feat/ux-trust-rework`; all changes are uncommitted (58 tracked files changed, 9 new files) awaiting the user's review.
Next step: user reviews the diff (`git diff main --stat`), then decides whether to commit / open a PR. Nothing is committed or pushed.
Blockers: none.
Context notes:
- Final verification: tsc clean; vitest 48 files / 510 tests pass; eslint 0 errors (45 warnings, mostly react-refresh export warnings); prettier clean; vite build OK with `sw.js` (imports `/push-sw.js`, no API caching), `manifest.webmanifest`, 28 precache entries. `src/server/balances.ts` has 0 removed lines vs main (calculation untouched).
- Browser-verified in demo mode at 390px and 1280px: Settle tab figures reconcile; overlays (Escape closes only topmost, focus on Cancel); add-expense flow; New ledger sheet; desktop rail + centred dialog; themed scrollbars; no console errors.
- Known follow-ups (not done on purpose): expense edit can overwrite a concurrent edit (needs partial-update API); push delivery untested on a real device; View Transitions not adopted (declarative BrowserRouter); optimistic settle/edit skipped by design; expense detail sheet does not reopen if an optimistic delete fails (toast only); at 390px the "N members · standing" line can still truncate by a few characters beside a 5-digit amount; SPEC/ARCHITECTURE "passkeys only" drift vs ADR 0006 predates this work; `.remember/tmp/last-ndc.ts` breaks `eslint .`; `mise` pnpm shim is broken (agents called `node_modules/.bin/*`).
