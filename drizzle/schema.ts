import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean, json } from "drizzle-orm/mysql-core";

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

export const apiKeys = mysqlTable("api_keys", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  exchange: varchar("exchange", { length: 32 }).notNull().default("bybit"),
  apiKey: text("apiKey").notNull(),
  apiSecret: text("apiSecret").notNull(),
  label: varchar("label", { length: 128 }),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const botState = mysqlTable("bot_state", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  status: mysqlEnum("status", ["stopped", "running", "paused", "error"]).default("stopped").notNull(),
  simulationMode: boolean("simulationMode").notNull().default(true),
  initialBalance: decimal("initialBalance", { precision: 16, scale: 2 }).default("5000.00"),
  currentBalance: decimal("currentBalance", { precision: 16, scale: 2 }).default("5000.00"),
  totalPnl: decimal("totalPnl", { precision: 16, scale: 2 }).default("0.00"),
  totalTrades: int("totalTrades").default(0),
  winningTrades: int("winningTrades").default(0),
  losingTrades: int("losingTrades").default(0),
  dailyPnl: decimal("dailyPnl", { precision: 16, scale: 2 }).default("0.00"),
  maxDrawdown: decimal("maxDrawdown", { precision: 8, scale: 4 }).default("0.0000"),
  dailyLoss: decimal("dailyLoss", { precision: 16, scale: 2 }).default("0.00"),
  uptime: int("uptime").default(0),
  cycles: int("cycles").default(0),
  startedAt: timestamp("startedAt"),
  config: json("config"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const strategies = mysqlTable("strategies", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  category: varchar("category", { length: 16 }).notNull().default("spot"),
  strategyType: mysqlEnum("strategyType", ["grid", "scalping"]).notNull(),
  market: mysqlEnum("market", ["crypto", "tradfi"]).notNull().default("crypto"),
  enabled: boolean("enabled").notNull().default(true),
  allocationPct: int("allocationPct").default(25),
  pnl: decimal("pnl", { precision: 16, scale: 2 }).default("0.00"),
  trades: int("trades").default(0),
  winningTrades: int("winningTrades").default(0),
  activeOrders: int("activeOrders").default(0),
  balance: decimal("balance", { precision: 16, scale: 2 }).default("0.00"),
  config: json("config"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const trades = mysqlTable("trades", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  side: mysqlEnum("side", ["buy", "sell"]).notNull(),
  strategy: varchar("strategy", { length: 32 }).notNull(),
  price: decimal("price", { precision: 16, scale: 8 }).notNull(),
  qty: decimal("qty", { precision: 16, scale: 8 }).notNull(),
  amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
  pnl: decimal("pnl", { precision: 16, scale: 2 }).default("0.00"),
  fee: decimal("fee", { precision: 16, scale: 4 }).default("0.0000"),
  simulation: boolean("simulation").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const pnlHistory = mysqlTable("pnl_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  totalPnl: decimal("totalPnl", { precision: 16, scale: 2 }).notNull(),
  balance: decimal("balance", { precision: 16, scale: 2 }).notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const opportunities = mysqlTable("opportunities", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  price: decimal("price", { precision: 16, scale: 8 }).notNull(),
  signal: mysqlEnum("signal", ["buy", "sell", "strong_buy", "strong_sell"]).notNull(),
  confidence: int("confidence").notNull(),
  reasons: json("reasons").notNull(),
  market: mysqlEnum("market", ["crypto", "tradfi"]).default("crypto"),
  isRead: boolean("isRead").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const aiAnalyses = mysqlTable("ai_analyses", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  analysisType: mysqlEnum("analysisType", ["market_overview", "coin_analysis", "risk_assessment", "opportunity"]).notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  content: text("content").notNull(),
  sentiment: mysqlEnum("sentiment", ["bullish", "bearish", "neutral"]).default("neutral"),
  symbols: json("symbols"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const priceCache = mysqlTable("price_cache", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 32 }).notNull().unique(),
  price: decimal("price", { precision: 16, scale: 8 }).notNull(),
  change24h: decimal("change24h", { precision: 8, scale: 4 }).default("0.0000"),
  volume24h: decimal("volume24h", { precision: 20, scale: 2 }).default("0.00"),
  high24h: decimal("high24h", { precision: 16, scale: 8 }),
  low24h: decimal("low24h", { precision: 16, scale: 8 }),
  market: mysqlEnum("market", ["crypto", "tradfi"]).default("crypto"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});