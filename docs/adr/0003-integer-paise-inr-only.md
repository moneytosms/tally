# 3. Integer paise, INR only

Date: 2026-08-11 · Status: accepted

## Context

Splitting money produces remainders. SQLite has no decimal type. Floating-point money is a well-known defect class.

Multi-currency was considered, briefly reopened, and rejected.

## Decision

All amounts are **integer paise**. No floating point in storage, in the API, or in any calculation. The UI divides by 100 for display only.

INR only. A `currency` column is carried as a constant anyway.

**The payer absorbs the rounding remainder.** If the payer isn't a participant, it falls to the first participant in **stable order** - order of addition to the expense, never display order.

Splits are **stored resolved**, not recomputed from weights.

## Consequences

- Deterministic, stateless rounding that is trivially explainable: whoever fronted the money takes the sub-rupee hit.
- Largest-remainder distribution was rejected - it invites "why do I owe one paisa more than her". Rotation was rejected - persistent state for sub-rupee amounts.
- Storing resolved splits means editing a participant set cannot silently rewrite history, which the edit-history feature requires.
- The carried `currency` constant makes a future multi-currency change a **data migration rather than a schema rewrite**. Note that multi-currency would also break the two-decimal assumption (JPY has zero, KWD three).
