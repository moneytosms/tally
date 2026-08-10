// Data-access layer.
//
// IMPORTANT: soft-delete filtering is enforced HERE, structurally.
// Never leave `deleted_at IS NULL` to individual callers — forgetting once
// produces wrong money. See docs/adr/0004.
export {};
