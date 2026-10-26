ALTER TABLE `oauth_flows` ADD `provider` text DEFAULT 'google' NOT NULL;--> statement-breakpoint
ALTER TABLE `oauth_flows` ADD `user_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `github_subject` text;--> statement-breakpoint
CREATE UNIQUE INDEX `github_identity` ON `users` (`github_subject`);