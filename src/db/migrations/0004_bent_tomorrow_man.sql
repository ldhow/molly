CREATE TABLE `decor_items` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`price_paid` integer NOT NULL,
	`acquired_at` integer NOT NULL,
	`layer` text,
	`x_fraction` real,
	`scale` real,
	`mirror` integer,
	`sort_order` integer
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `sold_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `sold_price` integer;