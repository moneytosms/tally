CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`ledger_id` text NOT NULL,
	`expense_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "comments_body_nonempty_ck" CHECK(length(trim("comments"."body")) > 0)
);
--> statement-breakpoint
CREATE INDEX `comments_expense_idx` ON `comments` (`expense_id`);--> statement-breakpoint
CREATE INDEX `comments_ledger_idx` ON `comments` (`ledger_id`);--> statement-breakpoint
CREATE TABLE `nudges` (
	`id` text PRIMARY KEY NOT NULL,
	`ledger_id` text NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `nudges_pair_idx` ON `nudges` (`from_user_id`,`to_user_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer NOT NULL,
	`failed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE TABLE `recurring_series` (
	`id` text PRIMARY KEY NOT NULL,
	`ledger_id` text NOT NULL,
	`description` text NOT NULL,
	`total` integer NOT NULL,
	`payer_member_id` text NOT NULL,
	`category_id` text,
	`notes` text,
	`mode` text NOT NULL,
	`split_template` text NOT NULL,
	`interval_unit` text NOT NULL,
	`interval_count` integer NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer,
	`next_occurrence_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`paused_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payer_member_id`) REFERENCES `ledger_members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recurring_mode_ck" CHECK("recurring_series"."mode" IN ('equal', 'exact', 'shares', 'percent')),
	CONSTRAINT "recurring_unit_ck" CHECK("recurring_series"."interval_unit" IN ('day', 'week', 'month')),
	CONSTRAINT "recurring_count_positive_ck" CHECK("recurring_series"."interval_count" > 0),
	CONSTRAINT "recurring_total_nonzero_ck" CHECK("recurring_series"."total" <> 0)
);
--> statement-breakpoint
CREATE INDEX `recurring_ledger_idx` ON `recurring_series` (`ledger_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`ledger_id` text NOT NULL,
	`description` text NOT NULL,
	`total` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`paid_at` integer NOT NULL,
	`payer_member_id` text NOT NULL,
	`category_id` text,
	`notes` text,
	`mode` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`series_id` text,
	`occurrence_at` integer,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payer_member_id`) REFERENCES `ledger_members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expenses_mode_ck" CHECK("__new_expenses"."mode" IN ('equal', 'exact', 'shares', 'percent')),
	CONSTRAINT "expenses_total_nonzero_ck" CHECK("__new_expenses"."total" <> 0),
	CONSTRAINT "expenses_currency_ck" CHECK("__new_expenses"."currency" = 'INR'),
	CONSTRAINT "expenses_series_pair_ck" CHECK(("__new_expenses"."series_id" IS NULL) = ("__new_expenses"."occurrence_at" IS NULL))
);
--> statement-breakpoint
-- HAND-EDITED: drizzle-kit emitted `series_id`/`occurrence_at` on both sides of
-- this copy, but they are new columns and do not exist on the old table. They
-- are NULL for every pre-existing expense — only generated occurrences carry them.
INSERT INTO `__new_expenses`("id", "ledger_id", "description", "total", "currency", "paid_at", "payer_member_id", "category_id", "notes", "mode", "created_by", "created_at", "updated_at", "deleted_at", "series_id", "occurrence_at") SELECT "id", "ledger_id", "description", "total", "currency", "paid_at", "payer_member_id", "category_id", "notes", "mode", "created_by", "created_at", "updated_at", "deleted_at", NULL, NULL FROM `expenses`;--> statement-breakpoint
DROP TABLE `expenses`;--> statement-breakpoint
ALTER TABLE `__new_expenses` RENAME TO `expenses`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `expenses_ledger_idx` ON `expenses` (`ledger_id`);--> statement-breakpoint
CREATE INDEX `expenses_category_idx` ON `expenses` (`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_series_occurrence_uq` ON `expenses` (`series_id`,`occurrence_at`);--> statement-breakpoint
-- Default category set. SPEC §13 left this unpicked; ten is enough to make the
-- charts meaningful without turning the picker into a scroll. `is_default`
-- marks them so the admin panel can tell seeded rows from user-added ones.
INSERT INTO `categories` ("id", "name", "icon", "is_default", "deleted_at") VALUES
  ('cat_food','Food & Drink','🍽',1,NULL),
  ('cat_groceries','Groceries','🛒',1,NULL),
  ('cat_transport','Transport','🚗',1,NULL),
  ('cat_stay','Stay','🏠',1,NULL),
  ('cat_shopping','Shopping','🛍',1,NULL),
  ('cat_entertainment','Entertainment','🎬',1,NULL),
  ('cat_utilities','Utilities','💡',1,NULL),
  ('cat_health','Health','⚕',1,NULL),
  ('cat_gifts','Gifts','🎁',1,NULL),
  ('cat_other','Other','📦',1,NULL);
