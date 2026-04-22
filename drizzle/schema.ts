import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, decimal, json } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const botState = mysqlTable("bot_state", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  isRunning: boolean("isRunning").default(false).notNull(),
  simulationMode: boolean("simulationMode").default(true).notNull(),
  selectedExchange: varchar("selectedExchange", { length: 32 }).default("bybit").notNull(),
  initialBalance: decimal("initialBalance", { precision: 18, scale: 2 }).default("5000"),
  currentBalance: decimal("currentBalance", { precision: 18, scale: 2 }).default("5000"),
  totalPnl: decimal("totalPnl", { precision: 18, scale: 2 }).default("0"),
  todayPnl: decimal("todayPnl", { precision: 18, scale: 2 }).default("0"),
  totalTrades: int("totalTrades").default(0),
  winningTrades: int("winningTrades").default(0),
  maxDrawdown: decimal("maxDrawdown", { precision: 8, scale: 4 }).default("0"),
  dailyLoss: decimal("dailyLoss", { precision: 18, scale: 2 }).default("0"),
  startedAt: timestamp("startedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const apiKeys = mysqlTable("api_keys", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  exchange: varchar("exchange", { length: 32 }).default("bybit").notNull(),
  apiKey: varchar("apiKey", { length: 128 }).notNull(),
  apiSecret: varchar("apiSecret", { length: 256 }).notNull(),
  passphrase: varchar("passphrase", { length: 256 }),
  label: varchar("label", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const strategies = mysqlTable("strategies", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  strategyType: varchar("strategyType", { length: 32 }).notNull(),
  market: varchar("market", { length: 16 }).default("crypto").notNull(),
  category: varchar("category", { length: 32 }).default("spot").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  allocationPct: int("allocationPct").default(0).notNull(),
  balance: decimal("balance", { precision: 18, scale: 2 }).default("0"),
  pnl: decimal("pnl", { precision: 18, scale: 2 }).default("0"),
  trades: int("trades").default(0),
  winningTrades: int("winningTrades").default(0),
  config: json("config"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const trades = mysqlTable("trades", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  side: varchar("side", { length: 8 }).notNull(),
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  qty: decimal("qty", { precision: 18, scale: 8 }).notNull(),
  pnl: decimal("pnl", { precision: 18, scale: 2 }).default("0"),
  strategy: varchar("strategy", { length: 32 }).notNull(),
  orderId: varchar("orderId", { length: 64 }),
  simulated: boolean("simulated").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const opportunities = mysqlTable("opportunities", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  signal: varchar("signal", { length: 32 }).notNull(),
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  confidence: int("confidence").notNull(),
  reasons: json("reasons"),
  isRead: boolean("isRead").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const pnlHistory = mysqlTable("pnl_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  pnl: decimal("pnl", { precision: 18, scale: 2 }).default("0").notNull(),
  balance: decimal("balance", { precision: 18, scale: 2 }).default("0").notNull(),
  trades: int("trades").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PnlHistory = typeof pnlHistory.$inferSelect;

export const openPositions = mysqlTable("open_positions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  strategyType: varchar("strategyType", { length: 32 }).notNull(), // grid | futures | scalping
  exchange: varchar("exchange", { length: 32 }).default("bybit").notNull(),
  buyPrice: decimal("buyPrice", { precision: 18, scale: 8 }).notNull(),
  qty: decimal("qty", { precision: 18, scale: 8 }).notNull(),
  tradeAmount: decimal("tradeAmount", { precision: 18, scale: 2 }),
  highestPrice: decimal("highestPrice", { precision: 18, scale: 8 }),
  trailingActive: boolean("trailingActive").default(false),
  openedAt: timestamp("openedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const aiAnalyses = mysqlTable("ai_analyses", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: varchar("type", { length: 32 }).notNull(),
  title: varchar("title", { length: 128 }).notNull(),
  content: text("content").notNull(),
  sentiment: varchar("sentiment", { length: 16 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
