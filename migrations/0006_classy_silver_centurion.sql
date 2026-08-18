PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`vpa` text,
	`email` text,
	`password_hash` text,
	`is_owner` integer DEFAULT false NOT NULL,
	`account_type` text DEFAULT 'full' NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "users_account_type_ck" CHECK("__new_users"."account_type" IN ('full', 'restricted'))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "display_name", "vpa", "email", "password_hash", "is_owner", "created_at", "deleted_at") SELECT "id", "display_name", "vpa", "email", "password_hash", "is_owner", "created_at", "deleted_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_owner_uq` ON `users` (`is_owner`) WHERE "users"."is_owner" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);