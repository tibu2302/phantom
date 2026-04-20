CREATE TABLE `pnl_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`date` varchar(10) NOT NULL,
	`pnl` decimal(18,2) NOT NULL DEFAULT '0',
	`balance` decimal(18,2) NOT NULL DEFAULT '0',
	`trades` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pnl_history_id` PRIMARY KEY(`id`)
);
