// FROZEN. See docs/adr/0002-rp-id-is-permanent.md
//
// Never derive this from location.hostname. Changing it destroys every
// passkey on the instance with no migration path.
export const RP_ID = "tally.moneytosms.workers.dev";
export const ORIGIN = "https://tally.moneytosms.workers.dev";
