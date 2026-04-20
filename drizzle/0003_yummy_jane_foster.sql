CREATE TABLE `ai_analyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` varchar(32) NOT NULL,
	`title` varchar(128) NOT NULL,
	`content` text NOT NULL,
	`sentiment` varchar(16),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_analyses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`exchange` varchar(32) NOT NULL DEFAULT 'bybit',
	`apiKey` varchar(128) NOT NULL,
	`apiSecret` varchar(256) NOT NULL,
	`label` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bot_state` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`isRunning` boolean NOT NULL DEFAULT false,
	`simulationMode` boolean NOT NULL DEFAULT true,
	`initialBalance` decimal(18,2) DEFAULT '5000',
	`currentBalance` decimal(18,2) DEFAULT '5000',
	`totalPnl` decimal(18,2) DEFAULT '0',
	`todayPnl` decimal(18,2) DEFAULT '0',
	`totalTrades` int DEFAULT 0,
	`winningTrades` int DEFAULT 0,
	`maxDrawdown` decimal(8,4) DEFAULT '0',
	`dailyLoss` decimal(18,2) DEFAULT '0',
	`startedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bot_state_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`signal` varchar(32) NOT NULL,
	`price` decimal(18,8) NOT NULL,
	`confidence` int NOT NULL,
	`reasons` json,
	`isRead` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `opportunities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `strategies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`strategyType` varchar(32) NOT NULL,
	`market` varchar(16) NOT NULL DEFAULT 'crypto',
	`category` varchar(32) NOT NULL DEFAULT 'spot',
	`enabled` boolean NOT NULL DEFAULT true,
	`allocationPct` int NOT NULL DEFAULT 0,
	`balance` decimal(18,2) DEFAULT '0',
	`pnl` decimal(18,2) DEFAULT '0',
	`trades` int DEFAULT 0,
	`winningTrades` int DEFAULT 0,
	`config` json,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `strategies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`side` varchar(8) NOT NULL,
	`price` decimal(18,8) NOT NULL,
	`qty` decimal(18,8) NOT NULL,
	`pnl` decimal(18,2) DEFAULT '0',
	`strategy` varchar(32) NOT NULL,
	`orderId` varchar(64),
	`simulated` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `trades_id` PRIMARY KEY(`id`)
);
