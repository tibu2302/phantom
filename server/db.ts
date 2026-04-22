import { eq, desc, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, botState, apiKeys, strategies, trades, opportunities, aiAnalyses, pnlHistory, openPositions } from "../drizzle/schema";
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

// ─── API Keys (multi-exchange: bybit | kucoin) ───
export async function saveApiKey(userId: number, data: { apiKey: string; apiSecret: string; passphrase?: string; label?: string; exchange?: string }) {
  const db = await getDb();
  if (!db) return;
  const exchange = data.exchange ?? "bybit";
  const existing = await db.select().from(apiKeys).where(and(eq(apiKeys.userId, userId), eq(apiKeys.exchange, exchange))).limit(1);
  if (existing.length > 0) {
    await db.update(apiKeys).set({ apiKey: data.apiKey, apiSecret: data.apiSecret, passphrase: data.passphrase ?? null, label: data.label ?? null }).where(and(eq(apiKeys.userId, userId), eq(apiKeys.exchange, exchange)));
  } else {
    await db.insert(apiKeys).values({ userId, exchange, apiKey: data.apiKey, apiSecret: data.apiSecret, passphrase: data.passphrase ?? null, label: data.label ?? null });
  }
}

export async function getApiKey(userId: number, exchange?: string) {
  const db = await getDb();
  if (!db) return null;
  if (exchange) {
    const rows = await db.select().from(apiKeys).where(and(eq(apiKeys.userId, userId), eq(apiKeys.exchange, exchange))).limit(1);
    return rows[0] ?? null;
  }
  // Legacy: return first key found
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function getAllApiKeys(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
}

export async function deleteApiKey(userId: number, exchange?: string) {
  const db = await getDb();
  if (!db) return;
  if (exchange) {
    await db.delete(apiKeys).where(and(eq(apiKeys.userId, userId), eq(apiKeys.exchange, exchange)));
  } else {
    await db.delete(apiKeys).where(eq(apiKeys.userId, userId));
  }
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
  // Match by (userId, symbol, strategyType) to allow multiple strategy types per symbol
  // e.g. XAUUSDT can have both "scalping" and "futures" strategies
  const existing = await db.select().from(strategies).where(
    and(eq(strategies.userId, userId), eq(strategies.symbol, data.symbol), eq(strategies.strategyType, data.strategyType))
  ).limit(1);
  if (existing.length > 0) {
    await db.update(strategies).set({
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

// ─── PnL History ───
export async function upsertDailyPnl(userId: number, pnl: number, balance: number, tradesCount: number) {
  const db = await getDb();
  if (!db) return;
  const today = new Date().toISOString().slice(0, 10);
  const existing = await db.select().from(pnlHistory).where(
    and(eq(pnlHistory.userId, userId), eq(pnlHistory.date, today))
  ).limit(1);
  if (existing.length > 0) {
    await db.update(pnlHistory).set({
      pnl: pnl.toFixed(2),
      balance: balance.toFixed(2),
      trades: tradesCount,
    }).where(and(eq(pnlHistory.userId, userId), eq(pnlHistory.date, today)));
  } else {
    await db.insert(pnlHistory).values({
      userId, date: today,
      pnl: pnl.toFixed(2),
      balance: balance.toFixed(2),
      trades: tradesCount,
    });
  }
}
export async function getPnlHistory(userId: number, days = 30) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pnlHistory)
    .where(eq(pnlHistory.userId, userId))
    .orderBy(desc(pnlHistory.date))
    .limit(days);
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


// ─── Open Positions Persistence ───
export async function saveOpenPositions(userId: number, positions: Record<string, Array<{ buyPrice: number; qty: string; highestPrice?: number; trailingActive?: boolean; openedAt?: number; tradeAmount?: number }>>, exchange: string) {
  const db = await getDb();
  if (!db) return;
  try {
    // Delete all existing positions for this user+exchange
    await db.delete(openPositions).where(and(eq(openPositions.userId, userId), eq(openPositions.exchange, exchange)));
    // Insert current positions
    for (const [symbol, posArr] of Object.entries(positions)) {
      for (const pos of posArr) {
        // Determine strategy type from context
        const stratType = symbol === "XAUUSDT" ? "scalping" : "grid";
        await db.insert(openPositions).values({
          userId,
          symbol,
          strategyType: stratType,
          exchange,
          buyPrice: pos.buyPrice.toFixed(8),
          qty: pos.qty,
          highestPrice: pos.highestPrice ? pos.highestPrice.toFixed(8) : null,
          trailingActive: pos.trailingActive ?? false,
          openedAt: new Date(pos.openedAt ?? Date.now()),
        });
      }
    }
  } catch (e) {
    console.error("[DB] Failed to save open positions:", e);
  }
}

export async function deleteOpenPosition(userId: number, symbol: string, buyPrice: number, qty: string, exchange: string) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.delete(openPositions).where(
      and(
        eq(openPositions.userId, userId),
        eq(openPositions.symbol, symbol),
        eq(openPositions.exchange, exchange),
        eq(openPositions.buyPrice, buyPrice.toFixed(8)),
        eq(openPositions.qty, qty),
      )
    );
    console.log(`[DB] Deleted phantom position ${symbol} buyPrice=${buyPrice} qty=${qty} exchange=${exchange}`);
  } catch (e) {
    console.error("[DB] Failed to delete open position:", e);
  }
}

export async function clearAllOpenPositions(userId: number) {
  const db = await getDb();
  if (!db) return;
  try {
    const result = await db.delete(openPositions).where(eq(openPositions.userId, userId));
    console.log(`[DB] Cleared all open positions for user ${userId}`);
  } catch (e) {
    console.error("[DB] Failed to clear open positions:", e);
  }
}

export async function loadOpenPositions(userId: number, exchange: string): Promise<Record<string, Array<{ symbol: string; buyPrice: number; qty: string; tradeAmount: number; category: "spot" | "linear"; gridLevelPrice: number; highestPrice?: number; openedAt: number }>>> {
  const db = await getDb();
  if (!db) return {};
  try {
    const rows = await db.select().from(openPositions).where(and(eq(openPositions.userId, userId), eq(openPositions.exchange, exchange)));
    const result: Record<string, Array<{ symbol: string; buyPrice: number; qty: string; tradeAmount: number; category: "spot" | "linear"; gridLevelPrice: number; highestPrice?: number; openedAt: number }>> = {};
    for (const row of rows) {
      if (!result[row.symbol]) result[row.symbol] = [];
      const bp = parseFloat(row.buyPrice);
      const q = parseFloat(row.qty);
      result[row.symbol].push({
        symbol: row.symbol,
        buyPrice: bp,
        qty: row.qty,
        tradeAmount: bp * q, // reconstruct approximate trade amount
        category: (row.strategyType === "futures" || row.strategyType === "scalping") ? "linear" : "spot",
        gridLevelPrice: bp, // approximate: use buy price as grid level
        highestPrice: row.highestPrice ? parseFloat(row.highestPrice) : undefined,
        openedAt: row.openedAt.getTime(),
      });
    }
    return result;
  } catch (e) {
    console.error("[DB] Failed to load open positions:", e);
    return {};
  }
}
