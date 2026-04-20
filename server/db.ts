import { eq, desc, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, apiKeys, botState, strategies, trades, pnlHistory, opportunities, aiAnalyses, priceCache } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ── API Keys ──
export async function saveApiKey(userId: number, apiKeyVal: string, apiSecretVal: string, label?: string) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(apiKeys).where(and(eq(apiKeys.userId, userId), eq(apiKeys.isActive, true))).limit(1);
  if (existing.length > 0) {
    await db.update(apiKeys).set({ apiKey: apiKeyVal, apiSecret: apiSecretVal, label: label || null }).where(eq(apiKeys.id, existing[0].id));
  } else {
    await db.insert(apiKeys).values({ userId, apiKey: apiKeyVal, apiSecret: apiSecretVal, label: label || null });
  }
}

export async function getApiKey(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(apiKeys).where(and(eq(apiKeys.userId, userId), eq(apiKeys.isActive, true))).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function deleteApiKey(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(apiKeys).set({ isActive: false }).where(eq(apiKeys.userId, userId));
}

// ── Bot State ──
export async function getOrCreateBotState(userId: number) {
  const db = await getDb();
  if (!db) return null;
  let result = await db.select().from(botState).where(eq(botState.userId, userId)).limit(1);
  if (result.length === 0) {
    await db.insert(botState).values({ userId });
    result = await db.select().from(botState).where(eq(botState.userId, userId)).limit(1);
  }
  return result[0] || null;
}

export async function updateBotState(userId: number, data: Partial<typeof botState.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  await db.update(botState).set(data).where(eq(botState.userId, userId));
}

// ── Strategies ──
export async function getStrategies(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(strategies).where(eq(strategies.userId, userId));
}

export async function initDefaultStrategies(userId: number) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(strategies).where(eq(strategies.userId, userId));
  if (existing.length > 0) return;
  const defaults = [
    { userId, symbol: "BTCUSDT", category: "spot", strategyType: "grid" as const, market: "crypto" as const, allocationPct: 30, balance: "1500.00" },
    { userId, symbol: "ETHUSDT", category: "spot", strategyType: "grid" as const, market: "crypto" as const, allocationPct: 25, balance: "1250.00" },
    { userId, symbol: "SP500.s", category: "linear", strategyType: "scalping" as const, market: "tradfi" as const, allocationPct: 20, balance: "1000.00" },
    { userId, symbol: "XAUUSD.s", category: "linear", strategyType: "scalping" as const, market: "tradfi" as const, allocationPct: 15, balance: "750.00" },
    { userId, symbol: "US100.s", category: "linear", strategyType: "scalping" as const, market: "tradfi" as const, allocationPct: 10, balance: "500.00" },
  ];
  for (const s of defaults) {
    await db.insert(strategies).values(s);
  }
}

export async function updateStrategy(id: number, data: Partial<typeof strategies.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  await db.update(strategies).set(data).where(eq(strategies.id, id));
}

// ── Trades ──
export async function recordTrade(data: typeof trades.$inferInsert) {
  const db = await getDb();
  if (!db) return;
  await db.insert(trades).values(data);
}

export async function getRecentTrades(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(trades).where(eq(trades.userId, userId)).orderBy(desc(trades.createdAt)).limit(limit);
}

// ── PnL History ──
export async function recordPnlSnapshot(userId: number, totalPnl: string, balance: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(pnlHistory).values({ userId, totalPnl, balance });
}

export async function getPnlHistory(userId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pnlHistory).where(eq(pnlHistory.userId, userId)).orderBy(desc(pnlHistory.timestamp)).limit(limit);
}

// ── Opportunities ──
export async function saveOpportunity(data: typeof opportunities.$inferInsert) {
  const db = await getDb();
  if (!db) return;
  await db.insert(opportunities).values(data);
}

export async function getOpportunities(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(opportunities).where(eq(opportunities.userId, userId)).orderBy(desc(opportunities.createdAt)).limit(limit);
}

export async function getUnreadOpportunityCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)` }).from(opportunities).where(and(eq(opportunities.userId, userId), eq(opportunities.isRead, false)));
  return result[0]?.count || 0;
}

export async function markOpportunitiesRead(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(opportunities).set({ isRead: true }).where(and(eq(opportunities.userId, userId), eq(opportunities.isRead, false)));
}

// ── AI Analyses ──
export async function saveAiAnalysis(data: typeof aiAnalyses.$inferInsert) {
  const db = await getDb();
  if (!db) return;
  await db.insert(aiAnalyses).values(data);
}

export async function getAiAnalyses(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiAnalyses).where(eq(aiAnalyses.userId, userId)).orderBy(desc(aiAnalyses.createdAt)).limit(limit);
}

// ── Price Cache ──
export async function updatePriceCache(symbol: string, data: { price: string; change24h?: string; volume24h?: string; high24h?: string; low24h?: string; market?: "crypto" | "tradfi" }) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(priceCache).where(eq(priceCache.symbol, symbol)).limit(1);
  if (existing.length > 0) {
    await db.update(priceCache).set(data).where(eq(priceCache.symbol, symbol));
  } else {
    await db.insert(priceCache).values({ symbol, ...data });
  }
}

export async function getPrices() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(priceCache);
}
