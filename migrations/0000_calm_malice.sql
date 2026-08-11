CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`backed_up` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_credential_id_unique` ON `credentials` (`credential_id`);--> statement-breakpoint
CREATE TABLE `expense_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`revised_by` text NOT NULL,
	`revised_at` integer NOT NULL,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revised_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `expense_revisions_expense_idx` ON `expense_revisions` (`expense_id`);--> statement-breakpoint
CREATE TABLE `expense_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`member_id` text NOT NULL,
	`amount` integer NOT NULL,
	`input_value` integer,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `ledger_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_splits_expense_member_uq` ON `expense_splits` (`expense_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `expense_splits_expense_idx` ON `expense_splits` (`expense_id`);--> statement-breakpoint
CREATE INDEX `expense_splits_member_idx` ON `expense_splits` (`member_id`);--> statement-breakpoint
CREATE TABLE `expenses` (
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
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payer_member_id`) REFERENCES `ledger_members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expenses_mode_ck" CHECK("expenses"."mode" IN ('equal', 'exact', 'shares', 'percent')),
	CONSTRAINT "expenses_total_nonzero_ck" CHECK("expenses"."total" <> 0),
	CONSTRAINT "expenses_currency_ck" CHECK("expenses"."currency" = 'INR')
);
--> statement-breakpoint
CREATE INDEX `expenses_ledger_idx` ON `expenses` (`ledger_id`);--> statement-breakpoint
CREATE TABLE `instance_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`ledger_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`consumed_by` text,
	`revoked_at` integer,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`consumed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `ledger_members` (
	`id` text PRIMARY KEY NOT NULL,
	`ledger_id` text NOT NULL,
	`user_id` text,
	`guest_name` text,
	`nickname` text,
	`joined_at` integer NOT NULL,
	`left_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ledger_members_user_xor_guest" CHECK(("ledger_members"."user_id" IS NULL) <> ("ledger_members"."guest_name" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_members_ledger_user_uq` ON `ledger_members` (`ledger_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `ledger_members_ledger_idx` ON `ledger_members` (`ledger_id`);--> statement-breakpoint
CREATE INDEX `ledger_members_user_idx` ON `ledger_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `ledgers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`end_date` integer,
	`budget` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`ledger_id` text NOT NULL,
	`from_member_id` text NOT NULL,
	`to_member_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`method` text NOT NULL,
	`note` text,
	`declared_by` text NOT NULL,
	`declared_at` integer NOT NULL,
	`acknowledged_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_member_id`) REFERENCES `ledger_members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_member_id`) REFERENCES `ledger_members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`declared_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settlements_method_ck" CHECK("settlements"."method" IN ('upi', 'manual', 'forgiven')),
	CONSTRAINT "settlements_amount_positive_ck" CHECK("settlements"."amount" > 0),
	CONSTRAINT "settlements_distinct_members_ck" CHECK("settlements"."from_member_id" <> "settlements"."to_member_id"),
	CONSTRAINT "settlements_currency_ck" CHECK("settlements"."currency" = 'INR')
);
--> statement-breakpoint
CREATE INDEX `settlements_ledger_idx` ON `settlements` (`ledger_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`vpa` text,
	`is_owner` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_owner_uq` ON `users` (`is_owner`) WHERE "users"."is_owner" = 1;