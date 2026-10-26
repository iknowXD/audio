CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`mime` text NOT NULL,
	`filename` text NOT NULL,
	`size` integer NOT NULL,
	`storage_key` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`search` text NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`added` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_flows` (
	`hash` text PRIMARY KEY NOT NULL,
	`nonce` text NOT NULL,
	`verifier` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `library` (
	`user_id` text NOT NULL,
	`track_id` text NOT NULL,
	`added` integer NOT NULL,
	`favorite` integer DEFAULT 0 NOT NULL,
	`play_count` integer DEFAULT 0 NOT NULL,
	`last_played` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `track_id`)
);
--> statement-breakpoint
CREATE INDEX `library_user` ON `library` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`csrf` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text,
	`salt` text,
	`admin` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_identity` ON `users` (`provider`,`subject`);