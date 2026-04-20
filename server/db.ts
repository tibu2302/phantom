import { eq, desc, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, botState, apiKeys, strategies, trades, opportunities, aiAnalyses } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

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
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
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
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Bot State ───
export async function getOrCreateBotState(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(botState).where(eq(botState.userId, userId)).limit(1);
  if (rows.length > 0) return rows[0];
  await db.insert(botState).values({ userId });
  const created = await db.select().from(botState).where(eq(botState.userId, userId)).limit(1);
  return created[0] ?? null;
}

export async function updateBotState(userId: number, data: Partial<typeof botState.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  await db.update(botState).set(data).where(eq(botState.userId, userId));
}

// ─── API Keys ───
export async function saveApiKey(userId: number, data: { apiKey: string; apiSecret: string; label?: string }) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).limit(1);
  if (existing.length > 0) {
    await db.update(apiKeys).set({ apiKey: data.apiKey, apiSecret: data.apiSecret, label: data.label ?? null }).where(eq(apiKeys.userId, userId));
  } else {
    await db.insert(apiKeys).values({ userId, apiKey: data.apiKey, apiSecret: data.apiSecret, label: data.label ?? null });
  }
}

export async function getApiKey(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function deleteApiKey(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(apiKeys).where(eq(apiKeys.userId, userId));
}

// ─── Strategies ───
export async function getUserStrategies(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(strategies).where(eq(strategies.userId, userId));
}

export async function upsertStrategy(userId: number, data: { symbol: string; strategyType: string; market?: string; category?: string; allocationPct?: number; enabled?: boolean; config?: unknown }) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(strategies).where(and(eq(strategies.userId, userId), eq(strategies.symbol, data.symbol))).limit(1);
  if (existing.length > 0) {
    await db.update(strategies).set({
      strategyType: data.strategyType,
      market: data.market ?? existing[0].market,
      category: data.category ?? existing[0].category,
      allocationPct: data.allocationPct ?? existing[0].allocationPct,
      enabled: data.enabled ?? existing[0].enabled,
      config: data.config ?? existing[0].config,
    }).where(eq(strategies.id, existing[0].id));
  } else {
    await db.insert(strategies).values({
      userId, symbol: data.symbol, strategyType: data.strategyType,
      market: data.market ?? "crypto", category: data.category ?? "spot",
      allocationPct: data.allocationPct ?? 0, enabled: data.enabled ?? true,
      config: data.config ?? null,
    });
  }
}

export async function toggleStrategy(id: number, enabled: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(strategies).set({ enabled }).where(eq(strategies.id, id));
}

// ─── Trades ───
export async function getUserTrades(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(trades).where(eq(trades.userId, userId)).orderBy(desc(trades.createdAt)).limit(limit);
}

export async function insertTrade(data: typeof trades.$inferInsert) {
  const db = await getDb();
  if (!db) return;
  await db.insert(trades).values(data);
}

// ─── Opportunities ───
export async function getUserOpportunities(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(opportunities).where(eq(opportunities.userId, userId)).orderBy(desc(opportunities.createdAt)).limit(limit);
}

export async function getUnreadOpportunityCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ count: sql<number>`count(*)` }).from(opportunities).where(and(eq(opportunities.userId, userId), eq(opportunities.isRead, false)));
  return rows[0]?.count ?? 0;
}

export async function markOpportunitiesRead(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(opportunities).set({ isRead: true }).where(and(eq(opportunities.userId, userId), eq(opportunities.isRead, false)));
}

export async function insertOpportunity(data: typeof opportunities.$inferInsert) {
  const db = await getDb();
  if (!db) return;
  await db.insert(opportunities).values(data);
}

// ─── AI Analyses ───
export async function getUserAnalyses(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiAnalyses).where(eq(aiAnalyses.userId, userId)).orderBy(desc(aiAnalyses.createdAt)).limit(limit);
}

export async function insertAnalysis(data: typeof aiAnalyses.$inferInsert) {
  const db = await getDb();
  if (!db) return;
  await db.insert(aiAnalyses).values(data);
}

// ─── Strategy Stats ───
export async function updateStrategyStats(strategyId: number, pnl: number, isWin: boolean) {
  const db = await getDb();
  if (!db) return;
  const rows = await db.select().from(strategies).where(eq(strategies.id, strategyId)).limit(1);
  if (rows.length === 0) return;
  const s = rows[0];
  const newPnl = parseFloat(s.pnl ?? "0") + pnl;
  const newTrades = (s.trades ?? 0) + 1;
  const newWinning = (s.winningTrades ?? 0) + (isWin ? 1 : 0);
  await db.update(strategies).set({
    pnl: newPnl.toFixed(2),
    trades: newTrades,
    winningTrades: newWinning,
  }).where(eq(strategies.id, strategyId));
}
