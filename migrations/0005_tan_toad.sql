ALTER TABLE `ledger_members` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ledgers` ADD `color` text CHECK("color" IS NULL OR "color" IN ('moss', 'clay', 'ochre', 'plum', 'sky', 'rose'));--> statement-breakpoint
ALTER TABLE `ledgers` ADD `emoji` text CHECK("emoji" IS NULL OR length("emoji") <= 8);
