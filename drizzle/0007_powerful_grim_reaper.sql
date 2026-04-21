CREATE TABLE `open_positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`strategyType` varchar(32) NOT NULL,
	`exchange` varchar(32) NOT NULL DEFAULT 'bybit',
	`buyPrice` decimal(18,8) NOT NULL,
	`qty` decimal(18,8) NOT NULL,
	`highestPrice` decimal(18,8),
	`trailingActive` boolean DEFAULT false,
	`openedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `open_positions_id` PRIMARY KEY(`id`)
);
