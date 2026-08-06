ALTER TABLE `sessions` ADD `in_tank` integer;--> statement-breakpoint
UPDATE sessions SET in_tank = 1 WHERE id IN (
  SELECT id FROM sessions ORDER BY started_at DESC LIMIT 25
);--> statement-breakpoint
UPDATE sessions SET in_tank = 0 WHERE in_tank IS NULL;