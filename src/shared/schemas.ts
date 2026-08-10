// Zod schemas shared by client and server. The SERVER parse is the trust boundary;
// the client parse is a UX convenience and is assumed bypassable.
// TODO: expense create/edit, settlement, invite, profile, ledger.
// Money rules: integer paise only, splits must sum exactly to total, percentages to 100,
// reject absurd magnitudes.
export {};
