CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`planned_minutes` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`outcome` text NOT NULL,
	`local_date` text NOT NULL
);
