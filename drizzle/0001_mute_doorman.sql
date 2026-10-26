ALTER TABLE `users` ADD `google_subject` text;--> statement-breakpoint
CREATE UNIQUE INDEX `google_identity` ON `users` (`google_subject`);