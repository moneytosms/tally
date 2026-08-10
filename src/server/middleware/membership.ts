// The single authorisation rule: is the caller a current member of this ledger?
//
// Routes MUST carry the ledger id as a path parameter so no handler can forget this.
// Exactly two exceptions exist: ledger deletion (creator only) and admin routes (owner only).
export {};
