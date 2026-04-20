CREATE TABLE `ai_analyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`analysisType` enum('market_overview','coin_analysis','risk_assessment','opportunity') NOT NULL,
	`title` varchar(256) NOT NULL,
	`content` text NOT NULL,
	`sentiment` enum('bullish','bearish','neutral') DEFAULT 'neutral',
	`symbols` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_analyses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`exchange` varchar(32) NOT NULL DEFAULT 'bybit',
	`apiKey` text NOT NULL,
	`apiSecret` text NOT NULL,
	`label` varchar(128),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bot_state` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` enum('stopped','running','paused','error') NOT NULL DEFAULT 'stopped',
	`simulationMode` boolean NOT NULL DEFAULT true,
	`initialBalance` decimal(16,2) DEFAULT '5000.00',
	`currentBalance` decimal(16,2) DEFAULT '5000.00',
	`totalPnl` decimal(16,2) DEFAULT '0.00',
	`totalTrades` int DEFAULT 0,
	`winningTrades` int DEFAULT 0,
	`losingTrades` int DEFAULT 0,
	`dailyPnl` decimal(16,2) DEFAULT '0.00',
	`maxDrawdown` decimal(8,4) DEFAULT '0.0000',
	`dailyLoss` decimal(16,2) DEFAULT '0.00',
	`uptime` int DEFAULT 0,
	`cycles` int DEFAULT 0,
	`startedAt` timestamp,
	`config` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bot_state_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`price` decimal(16,8) NOT NULL,
	`signal` enum('buy','sell','strong_buy','strong_sell') NOT NULL,
	`confidence` int NOT NULL,
	`reasons` json NOT NULL,
	`market` enum('crypto','tradfi') DEFAULT 'crypto',
	`isRead` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `opportunities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pnl_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`totalPnl` decimal(16,2) NOT NULL,
	`balance` decimal(16,2) NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pnl_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `price_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`price` decimal(16,8) NOT NULL,
	`change24h` decimal(8,4) DEFAULT '0.0000',
	`volume24h` decimal(20,2) DEFAULT '0.00',
	`high24h` decimal(16,8),
	`low24h` decimal(16,8),
	`market` enum('crypto','tradfi') DEFAULT 'crypto',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `price_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `price_cache_symbol_unique` UNIQUE(`symbol`)
);
--> statement-breakpoint
CREATE TABLE `strategies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`category` varchar(16) NOT NULL DEFAULT 'spot',
	`strategyType` enum('grid','scalping') NOT NULL,
	`market` enum('crypto','tradfi') NOT NULL DEFAULT 'crypto',
	`enabled` boolean NOT NULL DEFAULT true,
	`allocationPct` int DEFAULT 25,
	`pnl` decimal(16,2) DEFAULT '0.00',
	`trades` int DEFAULT 0,
	`winningTrades` int DEFAULT 0,
	`activeOrders` int DEFAULT 0,
	`balance` decimal(16,2) DEFAULT '0.00',
	`config` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `strategies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`strategy` varchar(32) NOT NULL,
	`price` decimal(16,8) NOT NULL,
	`qty` decimal(16,8) NOT NULL,
	`amount` decimal(16,2) NOT NULL,
	`pnl` decimal(16,2) DEFAULT '0.00',
	`fee` decimal(16,4) DEFAULT '0.0000',
	`simulation` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `trades_id` PRIMARY KEY(`id`)
);
