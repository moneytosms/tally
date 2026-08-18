// Zod schemas shared by client and server. The SERVER parse is the trust boundary;
// the client parse is a UX convenience and is assumed bypassable.
// Money is integer paise. Split sums are enforced by resolveSplits at save time.
import { z } from "zod";
import { MAX_PAISE } from "~/shared/money";

// Fixed accent palette for a ledger's cover colour (issue #27) - not a free hex,
// so every card stays legible across all seven paper themes. Client swatch
// values live in LedgersTab.tsx; this is the shape the DB check constraint
// (src/db/schema.ts) and the client both agree on.
export const LEDGER_COLOR_VALUES = ["moss", "clay", "ochre", "plum", "sky", "rose"] as const;

const id = z.string().min(1).max(64);
const paise = z.int().min(-MAX_PAISE).max(MAX_PAISE);
const epochMs = z.int().min(0);
export const name = z.string().trim().min(1).max(80);
const text = z.string().trim().max(2000);

export const createLedgerSchema = z.object({
  name,
  endDate: epochMs.nullable().default(null),
  budget: paise.positive().nullable().default(null),
  /** Invite links are opt-in per ledger (ADR 0007). Optional rather than
   *  defaulted so an old client that has never heard of the flag still parses;
   *  omitted means off, which is the safe direction for a bearer credential. */
  invitesEnabled: z.boolean().optional(),
  /** Copy the members of a ledger the caller is already in (SPEC §8). Not a
   *  ledger column - the server turns it into member rows and drops it. */
  cloneFrom: id.nullable().default(null),
  /** Cover accent (issue #27). Fixed palette, purely visual - never the only
   *  cue for anything money-related. */
  color: z.enum(LEDGER_COLOR_VALUES).nullable().default(null),
  /** A single glyph, kept short so it can only ever be an emoji-ish label, not
   *  a second name field in disguise. */
  emoji: z.string().trim().max(8).nullable().default(null),
});

// `cloneFrom` only means anything at creation: members join or leave afterwards,
// they are never re-cloned.
export const updateLedgerSchema = createLedgerSchema.omit({ cloneFrom: true }).partial();

/** Per-viewer home-screen pin (issue #26). Its own tiny schema because it is
 *  the one ledger field that belongs to the member row, not the ledger. */
export const pinLedgerSchema = z.object({ pinned: z.boolean() });

export const createExpenseSchema = z.object({
  description: name,
  total: paise.refine((v) => v !== 0, "an expense cannot be zero"),
  paidAtEpochMs: epochMs,
  categoryId: id.nullable().default(null),
  notes: text.nullable().default(null),
  payerMemberId: id,
  mode: z.enum(["equal", "exact", "shares", "percent"]),
  // Stable order (order of addition). `value` is per mode: exact paise, share
  // weight, or percent. Absent for equal.
  participants: z.array(z.object({ memberId: id, value: z.int().optional() })).min(1),
});

export const updateExpenseSchema = createExpenseSchema;

export const createSettlementSchema = z.object({
  fromMemberId: id,
  toMemberId: id,
  amount: paise.positive(),
  method: z.enum(["upi", "manual", "forgiven"]),
  note: text.nullable().default(null),
});

// The ledger comes from the path param and the token is server-generated, so an
// invite has no client-supplied body. `invites` has no nickname column; don't add
// a field here that nothing can store.
export const createInviteSchema = z.object({});

/** Lowercased at parse time - `findUserByEmail` matches case-sensitively and
 *  the unique index is the only thing stopping a duplicate account. */
export const emailSchema = z.email().trim().toLowerCase().max(254);
/** Length only. Composition rules buy nothing; see MIN_PASSWORD_LENGTH. */
export const passwordSchema = z.string().min(10).max(200);

export const signUpSchema = z.object({
  inviteToken: z.string().min(1),
  displayName: name,
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

/** `currentPassword` is required only when one is already set - the server
 *  decides that, because the client cannot be trusted with the question. */
export const setPasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200).nullish(),
  password: passwordSchema,
  /** Required the first time, when the account has no sign-in address yet
   *  (the owner, and anyone who enrolled with a passkey only). */
  email: emailSchema.nullish(),
});

export const addMemberSchema = z.object({
  userId: id,
});

// Email is deliberately NOT patchable here: it is the sign-in identifier and a
// unique key, so changing it is an auth operation, not a profile edit.
export const updateProfileSchema = z.object({
  displayName: name.optional(),
  vpa: z
    .string()
    .trim()
    .regex(/^[\w.\-]{2,60}@[a-zA-Z]{2,30}$/, "a VPA looks like name@bank")
    .nullable()
    .optional(),
});

export const addGuestSchema = z.object({
  guestName: name,
});

export const mergeGuestSchema = z.object({
  targetMemberId: id,
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export const createCategorySchema = z.object({
  name,
  icon: z.string().trim().min(1).max(8),
});

// A recurring series carries the same shape as an expense minus the date (each
// occurrence gets its own) plus the cadence. Splits are stored as a template and
// re-resolved per occurrence, so the remainder rule applies to each one.
export const createSeriesSchema = createExpenseSchema
  .omit({ paidAtEpochMs: true })
  .extend({
    intervalUnit: z.enum(["day", "week", "month"]),
    intervalCount: z.int().min(1).max(365),
    startAt: epochMs,
    endAt: epochMs.nullable().default(null),
  })
  .refine((v) => v.endAt === null || v.endAt > v.startAt, {
    message: "a series cannot end before it starts",
    path: ["endAt"],
  });

export const updateSeriesSchema = createSeriesSchema;

export const pushSubscribeSchema = z.object({
  endpoint: z.url().max(1000),
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(200),
});

export const nudgeSchema = z.object({
  ledgerId: id,
  toUserId: id,
});

export type CreateLedger = z.infer<typeof createLedgerSchema>;
export type CreateComment = z.infer<typeof createCommentSchema>;
export type CreateCategory = z.infer<typeof createCategorySchema>;
export type CreateSeries = z.infer<typeof createSeriesSchema>;
export type PushSubscribe = z.infer<typeof pushSubscribeSchema>;
export type Nudge = z.infer<typeof nudgeSchema>;
export type UpdateLedger = z.infer<typeof updateLedgerSchema>;
export type CreateExpense = z.infer<typeof createExpenseSchema>;
export type UpdateExpense = z.infer<typeof updateExpenseSchema>;
export type CreateSettlement = z.infer<typeof createSettlementSchema>;
export type CreateInvite = z.infer<typeof createInviteSchema>;
export type UpdateProfile = z.infer<typeof updateProfileSchema>;
export type AddGuest = z.infer<typeof addGuestSchema>;
