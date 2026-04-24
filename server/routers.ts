import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { invokeLLM } from "./_core/llm";
import { startEngine, stopEngine, emergencyStopEngine, getLivePrices, isEngineRunning, getEngineCycles, getOpenPositions, withRetry } from "./tradingEngine";
import { fetchFearGreedIndex, getFearGreedSignal, analyzeSentiment, detectCandlePatterns, getLearningInsights, getRLMultiplier } from "./aiEngine";
import { getAdvancedDataSignal } from "./advancedData";
import { autoTuneParameters, recordTradeForTuning, generatePerformanceReport } from "./autoOptimizer";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  bot: router({
    status: protectedProcedure.query(async ({ ctx }) => {
      const state = await db.getOrCreateBotState(ctx.user.id);
      const unread = await db.getUnreadOpportunityCount(ctx.user.id);
      const recentOpps = await db.getUserOpportunities(ctx.user.id, 10);
      const prices = getLivePrices();
      const engineRunning = isEngineRunning(ctx.user.id);
      const openPositions = getOpenPositions(ctx.user.id);
      const totalUnrealizedPnl = [...openPositions.grid, ...openPositions.futures]
        .reduce((sum, p) => sum + p.unrealizedPnl, 0);
      return {
        state,
        unreadNotifications: unread,
        recentOpportunities: recentOpps,
        livePrices: prices,
        engineRunning,
        cycles: getEngineCycles(ctx.user.id),
        openPositions,
        totalUnrealizedPnl,
      };
    }),
    start: protectedProcedure.mutation(async ({ ctx }) => {
      // Auto-seed default strategies if none exist
      const existingStrats = await db.getUserStrategies(ctx.user.id);
      // v10.7: CONCENTRATED — Only XAU, BTC, ETH. All other coins disabled.
      // Force-sync: ALWAYS upsert strategies with concentrated allocation
      {
        const defaultStrats: Array<{ symbol: string; strategyType: string; market: string; category: string; allocationPct: number; enabled: boolean; config?: any }> = [
          // Grid strategies — only BTC & ETH (LINEAR/USDT-settled)
          { symbol: "BTCUSDT", strategyType: "grid", market: "crypto", category: "linear", allocationPct: 50, enabled: true },
          { symbol: "ETHUSDT", strategyType: "grid", market: "crypto", category: "linear", allocationPct: 50, enabled: true },
          // Scalping — XAU is king (50% allocation)
          { symbol: "XAUUSDT", strategyType: "scalping", market: "tradfi", category: "linear", allocationPct: 50, enabled: true },
          { symbol: "BTCUSDT", strategyType: "scalping", market: "crypto", category: "linear", allocationPct: 25, enabled: true },
          { symbol: "ETHUSDT", strategyType: "scalping", market: "crypto", category: "linear", allocationPct: 25, enabled: true },
          // Futures — XAU 30% + BTC/ETH 25% each
          { symbol: "XAUUSDT", strategyType: "futures", market: "tradfi", category: "linear", allocationPct: 30, enabled: true, config: { leverage: 5, takeProfitPct: 1.5 } },
          { symbol: "BTCUSDT", strategyType: "futures", market: "crypto", category: "linear", allocationPct: 25, enabled: true, config: { leverage: 5, takeProfitPct: 1.5 } },
          { symbol: "ETHUSDT", strategyType: "futures", market: "crypto", category: "linear", allocationPct: 25, enabled: true, config: { leverage: 5, takeProfitPct: 1.5 } },
        ];
        // Disable ALL strategies not in the concentrated list
        const allowedKeys = new Set(defaultStrats.map(s => `${s.symbol}_${s.strategyType}`));
        for (const existing of existingStrats) {
          const key = `${existing.symbol}_${existing.strategyType}`;
          if (!allowedKeys.has(key) && existing.enabled) {
            await db.upsertStrategy(ctx.user.id, { ...existing, enabled: false } as any);
            console.log(`[Bot] v10.7: DISABLED ${existing.strategyType} ${existing.symbol}`);
          }
        }
        let synced = 0;
        for (const strat of defaultStrats) {
          await db.upsertStrategy(ctx.user.id, strat as any);
          synced++;
        }
        console.log(`[Bot] v10.7: Synced ${synced} CONCENTRATED strategies (XAU+BTC+ETH only) for user ${ctx.user.id}`);
      }
      const result = await startEngine(ctx.user.id);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true };
    }),
    stop: protectedProcedure.mutation(async ({ ctx }) => {
      await stopEngine(ctx.user.id);
      return { success: true };
    }),
    emergencyStop: protectedProcedure.mutation(async ({ ctx }) => {
      await emergencyStopEngine(ctx.user.id);
      return { success: true };
    }),
    updateSettings: protectedProcedure.input(z.object({
      simulationMode: z.boolean().optional(),
      initialBalance: z.string().optional(),
      selectedExchange: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      const data: Record<string, unknown> = {};
      if (input.simulationMode !== undefined) data.simulationMode = input.simulationMode;
      if (input.initialBalance !== undefined) {
        data.initialBalance = input.initialBalance;
        data.currentBalance = input.initialBalance;
      }
      if (input.selectedExchange !== undefined) data.selectedExchange = input.selectedExchange;
      await db.updateBotState(ctx.user.id, data as any);
      return { success: true };
    }),
    markNotificationsRead: protectedProcedure.mutation(async ({ ctx }) => {
      await db.markOpportunitiesRead(ctx.user.id);
      return { success: true };
    }),
    livePrices: protectedProcedure.query(async () => {
      return getLivePrices();
    }),
    exchangeBalances: protectedProcedure.query(async ({ ctx }) => {
      const results: {
        bybit?: { balance: string; available?: string; unrealizedPnl?: string; error?: string };
        kucoin?: { balance: string; available?: string; error?: string };
        totalBalance: string;
        initialDeposit: string;
        realProfit: string;
        realProfitPct: string;
        todayPnl: string;
        yesterdayPnl: string;
        weekPnl: string;
        yearPnl: string;
        todayTrades: number;
        totalTrades: number;
        winRate: string;
        openPositions: { count: number; unrealizedPnl: string };
      } = {
        totalBalance: "0", initialDeposit: "0", realProfit: "0", realProfitPct: "0",
        todayPnl: "0", yesterdayPnl: "0", weekPnl: "0", yearPnl: "0",
        todayTrades: 0, totalTrades: 0, winRate: "0",
        openPositions: { count: 0, unrealizedPnl: "0" },
      };

      let bybitBal = 0, kucoinBal = 0;

      // Bybit balance (REAL from API)
      try {
        const bybitKeys = await db.getApiKey(ctx.user.id, "bybit");
        if (bybitKeys) {
          const { RestClientV5 } = await import("bybit-api");
          const client = new RestClientV5({ key: bybitKeys.apiKey, secret: bybitKeys.apiSecret });
          const res = await withRetry(() => client.getWalletBalance({ accountType: "UNIFIED" }), "Bybit getWalletBalance");
          if (res.retCode === 0) {
            const account = (res.result as any)?.list?.[0];
            bybitBal = parseFloat(account?.totalEquity ?? "0");
            const available = parseFloat(account?.totalAvailableBalance ?? "0");
            const unrealizedPnl = parseFloat(account?.totalPerpUPL ?? "0");
            results.bybit = {
              balance: bybitBal.toFixed(2),
              available: available.toFixed(2),
              unrealizedPnl: unrealizedPnl.toFixed(2),
            };
          } else {
            results.bybit = { balance: "0", error: res.retMsg };
          }
        }
      } catch (e: any) {
        results.bybit = { balance: "0", error: e.message };
      }

      // KuCoin balance (REAL from API — sum all account types)
      try {
        const kucoinKeys = await db.getApiKey(ctx.user.id, "kucoin");
        if (kucoinKeys) {
          const { SpotClient } = await import("kucoin-api");
          const client = new SpotClient({ apiKey: kucoinKeys.apiKey, apiSecret: kucoinKeys.apiSecret, apiPassphrase: kucoinKeys.passphrase ?? "" });
          // Query all account types: main, trade, trade_hf
          const [mainRes, tradeRes, hfRes] = await Promise.allSettled([
            withRetry(() => client.getBalances({ type: "main" }), "KuCoin getBalances main"),
            withRetry(() => client.getBalances({ type: "trade" }), "KuCoin getBalances trade"),
            withRetry(() => client.getBalances({ type: "trade_hf" as any }), "KuCoin getBalances trade_hf"),
          ]);
          let totalBal = 0;
          let totalAvail = 0;
          const allPrices = getLivePrices();
          const processAccounts = (res: any) => {
            if (res.status !== "fulfilled" || res.value?.code !== "200000") return;
            const accounts = res.value.data as any[];
            if (!Array.isArray(accounts)) return;
            for (const acc of accounts) {
              const cur = acc.currency;
              const bal = parseFloat(acc.balance ?? "0");
              const avail = parseFloat(acc.available ?? "0");
              if (cur === "USDT" || cur === "USDC" || cur === "USD") {
                totalBal += bal;
                totalAvail += avail;
              } else {
                // Convert to USD using live prices (keys are like BTCUSDT, ETHUSDT)
                const price = allPrices[`${cur}USDT`]?.lastPrice ?? allPrices[`${cur}-USDT`]?.lastPrice ?? 0;
                if (price > 0) {
                  totalBal += bal * price;
                  totalAvail += avail * price;
                }
              }
            }
          };
          processAccounts(mainRes);
          processAccounts(tradeRes);
          processAccounts(hfRes);
          kucoinBal = totalBal;
          results.kucoin = {
            balance: kucoinBal.toFixed(2),
            available: totalAvail.toFixed(2),
          };
        }
      } catch (e: any) {
        results.kucoin = { balance: "0", error: e.message };
      }

      // Total balance from exchanges
      const totalBal = bybitBal + kucoinBal;
      results.totalBalance = totalBal.toFixed(2);

      // Initial deposit from DB (user-configurable)
      const state = await db.getOrCreateBotState(ctx.user.id);
      const totalInitial = parseFloat(state?.initialBalance ?? "2500");
      results.initialDeposit = totalInitial.toFixed(2);

      // Real profit = current exchange balance - initial deposit
      const realProfit = totalBal - totalInitial;
      results.realProfit = realProfit.toFixed(2);
      results.realProfitPct = totalInitial > 0 ? ((realProfit / totalInitial) * 100).toFixed(2) : "0";

      // Today's PnL from trades table
      try {
        const allTrades = await db.getUserTrades(ctx.user.id, 5000);
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayTrades = allTrades.filter(t => new Date(t.createdAt) >= todayStart);
        const todayPnl = todayTrades.reduce((sum, t) => sum + parseFloat(t.pnl ?? "0"), 0);
        results.todayPnl = todayPnl.toFixed(2);
        results.todayTrades = todayTrades.length;
        results.totalTrades = allTrades.length;

        // Win rate (trades with pnl > 0)
        const sellTrades = allTrades.filter(t => t.side === "sell");
        const winTrades = sellTrades.filter(t => parseFloat(t.pnl ?? "0") > 0);
        results.winRate = sellTrades.length > 0 ? ((winTrades.length / sellTrades.length) * 100).toFixed(1) : "0";
      } catch { /* trades query failed */ }

      // Yesterday, Week, Year PnL from pnl_history
      try {
        const pnlHist = await db.getPnlHistory(ctx.user.id, 365);
        const now = new Date();
        const yesterdayStr = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
        const weekAgo = new Date(now.getTime() - 7 * 86400000);
        const yearStart = new Date(now.getFullYear(), 0, 1);
        // Yesterday PnL
        const yesterdayEntry = pnlHist.find(h => h.date === yesterdayStr);
        results.yesterdayPnl = yesterdayEntry ? parseFloat(yesterdayEntry.pnl ?? "0").toFixed(2) : "0";
        // Week PnL (sum of last 7 days)
        const weekPnl = pnlHist.filter(h => new Date(h.date) >= weekAgo).reduce((s, h) => s + parseFloat(h.pnl ?? "0"), 0);
        results.weekPnl = weekPnl.toFixed(2);
        // Year PnL (sum from Jan 1)
        const yearPnl = pnlHist.filter(h => new Date(h.date) >= yearStart).reduce((s, h) => s + parseFloat(h.pnl ?? "0"), 0);
        results.yearPnl = yearPnl.toFixed(2);
      } catch { /* pnl history query failed */ }

      // Open positions from engine
      try {
        const positions = getOpenPositions(ctx.user.id);
        const gridCount = positions.grid.length;
        const futCount = positions.futures.length;
        const gridPnl = positions.grid.reduce((s, p) => s + p.unrealizedPnl, 0);
        const futPnl = positions.futures.reduce((s, p) => s + p.unrealizedPnl, 0);
        results.openPositions = {
          count: gridCount + futCount,
          unrealizedPnl: (gridPnl + futPnl).toFixed(2),
        };
      } catch { /* engine not running */ }

      return results;
    }),
  }),

  // Public prices endpoint — works without login
  prices: router({
    live: publicProcedure.query(async () => {
      return getLivePrices();
    }),
  }),

  apiKeys: router({
    get: protectedProcedure.input(z.object({ exchange: z.string().optional() }).optional()).query(async ({ ctx, input }) => {
      const exchange = input?.exchange;
      if (exchange) {
        const key = await db.getApiKey(ctx.user.id, exchange);
        if (!key) return null;
        return { id: key.id, exchange: key.exchange, label: key.label, apiKey: key.apiKey.slice(0, 6) + "..." + key.apiKey.slice(-4), hasSecret: true, hasPassphrase: !!key.passphrase, createdAt: key.createdAt };
      }
      // Return all keys for all exchanges
      const allKeys = await db.getAllApiKeys(ctx.user.id);
      return allKeys.map(key => ({
        id: key.id, exchange: key.exchange, label: key.label,
        apiKey: key.apiKey.slice(0, 6) + "..." + key.apiKey.slice(-4),
        hasSecret: true, hasPassphrase: !!key.passphrase, createdAt: key.createdAt,
      }));
    }),
    save: protectedProcedure.input(z.object({
      apiKey: z.string().min(1),
      apiSecret: z.string().min(1),
      passphrase: z.string().optional(),
      label: z.string().optional(),
      exchange: z.string().default("bybit"),
    })).mutation(async ({ ctx, input }) => {
      await db.saveApiKey(ctx.user.id, input);
      const existingStrategies = await db.getUserStrategies(ctx.user.id);
      if (existingStrategies.length === 0) {
        await db.upsertStrategy(ctx.user.id, { symbol: "BTCUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 40 });
        await db.upsertStrategy(ctx.user.id, { symbol: "ETHUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 30 });
        await db.upsertStrategy(ctx.user.id, { symbol: "XAUUSDT", strategyType: "scalping", market: "tradfi", category: "linear", allocationPct: 50 });
      }
      return { success: true };
    }),
    delete: protectedProcedure.input(z.object({ exchange: z.string().optional() }).optional()).mutation(async ({ ctx, input }) => {
      await db.deleteApiKey(ctx.user.id, input?.exchange);
      return { success: true };
    }),
    testConnection: protectedProcedure.input(z.object({ exchange: z.string().default("bybit") }).optional()).mutation(async ({ ctx, input }) => {
      const exchange = input?.exchange ?? "bybit";
      const keys = await db.getApiKey(ctx.user.id, exchange);
      if (!keys) return { success: false, error: `No API keys configured for ${exchange}` };
      try {
        if (exchange === "kucoin") {
          const { SpotClient } = await import("kucoin-api");
          const client = new SpotClient({ apiKey: keys.apiKey, apiSecret: keys.apiSecret, apiPassphrase: keys.passphrase ?? "" });
          const res = await client.getAccountSummary();
          if (res.code === "200000") {
            const summary = res.data as any;
            const totalUsd = parseFloat(summary?.totalBalance ?? summary?.availableBalance ?? "0");
            return { success: true, balance: totalUsd.toFixed(2), coins: 1 };
          }
          return { success: false, error: (res as any).msg || "Connection failed" };
        } else {
          const { RestClientV5 } = await import("bybit-api");
          const client = new RestClientV5({ key: keys.apiKey, secret: keys.apiSecret });
          const res = await withRetry(() => client.getWalletBalance({ accountType: "UNIFIED" }), "Bybit testConnection");
          if (res.retCode === 0) {
            const coins = (res.result as any)?.list?.[0]?.coin ?? [];
            const totalUsd = (res.result as any)?.list?.[0]?.totalEquity ?? "0";
            return { success: true, balance: totalUsd, coins: coins.length };
          }
          return { success: false, error: res.retMsg || "Connection failed" };
        }
      } catch (e: any) {
        return { success: false, error: e.message || "Connection failed" };
      }
    }),
  }),

  strategies: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getUserStrategies(ctx.user.id);
    }),
    toggle: protectedProcedure.input(z.object({ id: z.number(), enabled: z.boolean() })).mutation(async ({ input }) => {
      await db.toggleStrategy(input.id, input.enabled);
      return { success: true };
    }),
    upsert: protectedProcedure.input(z.object({
      symbol: z.string(),
      strategyType: z.string(),
      market: z.string().optional(),
      category: z.string().optional(),
      allocationPct: z.number().optional(),
      enabled: z.boolean().optional(),
    })).mutation(async ({ ctx, input }) => {
      await db.upsertStrategy(ctx.user.id, input);
      return { success: true };
    }),
    updateConfig: protectedProcedure.input(z.object({
      id: z.number(),
      config: z.object({
        gridLevels: z.number().min(2).max(50).optional(),
        gridSpreadPct: z.number().min(0.1).max(20).optional(),
        scalpingThresholdPct: z.number().min(0.1).max(5).optional(),
        allocationPct: z.number().min(1).max(100).optional(),
        leverage: z.number().min(1).max(10).optional(),
        takeProfitPct: z.number().min(0.1).max(20).optional(),
        stopLossPct: z.number().min(0.1).max(10).optional(),
        trailingStopPct: z.number().min(0.1).max(10).optional(),
        trailingActivationPct: z.number().min(0.1).max(10).optional(),
        maxHoldHours: z.number().min(1).max(168).optional(),
        maxOpenPositions: z.number().min(1).max(50).optional(),
        minProfitUsd: z.number().min(0).max(100).optional(),
      }),
    })).mutation(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) return { success: false };
      const { eq } = await import("drizzle-orm");
      const { strategies: strategiesTable } = await import("../drizzle/schema");
      const rows = await dbConn.select().from(strategiesTable).where(eq(strategiesTable.id, input.id)).limit(1);
      if (rows.length === 0) return { success: false };
      const existing = rows[0];
      const mergedConfig = { ...(existing.config as object ?? {}), ...input.config };
      const updateData: Record<string, unknown> = { config: mergedConfig };
      if (input.config.allocationPct !== undefined) updateData.allocationPct = input.config.allocationPct;
      await dbConn.update(strategiesTable).set(updateData as any).where(eq(strategiesTable.id, input.id));
      return { success: true };
    }),
    klines: protectedProcedure.input(z.object({
      symbol: z.string(),
      interval: z.string().default("15"),
      limit: z.number().default(100),
    })).query(async ({ input }) => {
      try {
        const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${input.symbol}&interval=${input.interval}&limit=${input.limit}`;
        const res = await fetch(url);
        const data = await res.json() as any;
        if (data.retCode !== 0) return [];
        // Each item: [startTime, open, high, low, close, volume, turnover]
        return (data.result?.list ?? []).map((k: string[]) => ({
          time: Math.floor(parseInt(k[0]) / 1000),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        })).reverse();
      } catch {
        return [];
      }
    }),
  }),

  pnl: router({
    history: protectedProcedure.input(z.object({ days: z.number().default(30) }).optional()).query(async ({ ctx, input }) => {
      return db.getPnlHistory(ctx.user.id, input?.days ?? 30);
    }),
    // Advanced period-based PnL stats
    advancedStats: protectedProcedure.input(z.object({
      period: z.enum(["today", "7d", "30d", "year", "all"]).default("today"),
    }).optional()).query(async ({ ctx, input }) => {
      const period = input?.period ?? "today";
      const allTrades = await db.getUserTrades(ctx.user.id, 50000);
      const allStrategies = await db.getUserStrategies(ctx.user.id);
      const pnlHist = await db.getPnlHistory(ctx.user.id, 365);
      const now = new Date();
      // Calculate period start date
      let periodStart: Date;
      switch (period) {
        case "today": periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
        case "7d": periodStart = new Date(now.getTime() - 7 * 86400000); break;
        case "30d": periodStart = new Date(now.getTime() - 30 * 86400000); break;
        case "year": periodStart = new Date(now.getFullYear(), 0, 1); break;
        case "all": periodStart = new Date(0); break;
      }
      // Filter trades by period
      const periodTrades = allTrades.filter(t => new Date(t.createdAt) >= periodStart);
      const sellTrades = periodTrades.filter(t => t.side === "sell");
      const buyTrades = periodTrades.filter(t => t.side === "buy");
      // PnL calculations — gains minus losses = real profit
      const totalGains = sellTrades.filter(t => parseFloat(t.pnl ?? "0") > 0).reduce((s, t) => s + parseFloat(t.pnl ?? "0"), 0);
      const totalLosses = Math.abs(sellTrades.filter(t => parseFloat(t.pnl ?? "0") < 0).reduce((s, t) => s + parseFloat(t.pnl ?? "0"), 0));
      const netProfit = totalGains - totalLosses;
      const winTrades = sellTrades.filter(t => parseFloat(t.pnl ?? "0") > 0).length;
      const loseTrades = sellTrades.filter(t => parseFloat(t.pnl ?? "0") < 0).length;
      const winRate = sellTrades.length > 0 ? (winTrades / sellTrades.length) * 100 : 0;
      // Average trade PnL
      const avgWin = winTrades > 0 ? totalGains / winTrades : 0;
      const avgLoss = loseTrades > 0 ? totalLosses / loseTrades : 0;
      // Best and worst single trade
      const allPnls = sellTrades.map(t => parseFloat(t.pnl ?? "0"));
      const bestTrade = allPnls.length > 0 ? Math.max(...allPnls) : 0;
      const worstTrade = allPnls.length > 0 ? Math.min(...allPnls) : 0;
      // PnL by strategy type
      const strategyBreakdown: Record<string, { pnl: number; trades: number; wins: number; losses: number }> = {};
      for (const t of periodTrades) {
        const sType = t.strategy ?? "unknown";
        if (!strategyBreakdown[sType]) strategyBreakdown[sType] = { pnl: 0, trades: 0, wins: 0, losses: 0 };
        strategyBreakdown[sType].trades++;
        const pnl = parseFloat(t.pnl ?? "0");
        strategyBreakdown[sType].pnl += pnl;
        if (t.side === "sell") {
          if (pnl > 0) strategyBreakdown[sType].wins++;
          else if (pnl < 0) strategyBreakdown[sType].losses++;
        }
      }
      // PnL by symbol (top performers)
      const symbolBreakdown: Record<string, { pnl: number; trades: number }> = {};
      for (const t of periodTrades) {
        const sym = t.symbol;
        if (!symbolBreakdown[sym]) symbolBreakdown[sym] = { pnl: 0, trades: 0 };
        symbolBreakdown[sym].pnl += parseFloat(t.pnl ?? "0");
        symbolBreakdown[sym].trades++;
      }
      const topSymbols = Object.entries(symbolBreakdown)
        .map(([symbol, data]) => ({ symbol, ...data }))
        .sort((a, b) => b.pnl - a.pnl)
        .slice(0, 10);
      // Daily PnL from pnl_history for chart
      const filteredHistory = pnlHist.filter(h => {
        const d = new Date(h.date);
        return d >= periodStart;
      });
      // Best day / worst day / avg daily
      const dailyPnls = filteredHistory.map(h => parseFloat(h.pnl ?? "0"));
      const bestDay = dailyPnls.length > 0 ? Math.max(...dailyPnls) : 0;
      const worstDay = dailyPnls.length > 0 ? Math.min(...dailyPnls) : 0;
      const avgDaily = dailyPnls.length > 0 ? dailyPnls.reduce((s, v) => s + v, 0) / dailyPnls.length : 0;
      // Profit factor
      const profitFactor = totalLosses > 0 ? totalGains / totalLosses : totalGains > 0 ? 999 : 0;
      // Strategy-level PnL from strategies table (cumulative)
      const strategyStats = allStrategies.map(s => ({
        symbol: s.symbol,
        strategyType: s.strategyType,
        pnl: parseFloat(s.pnl ?? "0"),
        trades: s.trades ?? 0,
        winningTrades: s.winningTrades ?? 0,
        enabled: s.enabled,
      }));
      return {
        period,
        totalTrades: periodTrades.length,
        sellTrades: sellTrades.length,
        buyTrades: buyTrades.length,
        totalGains: parseFloat(totalGains.toFixed(2)),
        totalLosses: parseFloat(totalLosses.toFixed(2)),
        netProfit: parseFloat(netProfit.toFixed(2)),
        winTrades,
        loseTrades,
        winRate: parseFloat(winRate.toFixed(1)),
        avgWin: parseFloat(avgWin.toFixed(2)),
        avgLoss: parseFloat(avgLoss.toFixed(2)),
        bestTrade: parseFloat(bestTrade.toFixed(2)),
        worstTrade: parseFloat(worstTrade.toFixed(2)),
        bestDay: parseFloat(bestDay.toFixed(2)),
        worstDay: parseFloat(worstDay.toFixed(2)),
        avgDaily: parseFloat(avgDaily.toFixed(2)),
        profitFactor: parseFloat(profitFactor.toFixed(2)),
        strategyBreakdown,
        topSymbols,
        pnlChart: filteredHistory.reverse(),
        strategyStats,
      };
    }),
  }),

  trades: router({
    list: protectedProcedure.input(z.object({ limit: z.number().optional() }).optional()).query(async ({ ctx, input }) => {
      return db.getUserTrades(ctx.user.id, input?.limit ?? 50);
    }),
    exportCsv: protectedProcedure.query(async ({ ctx }) => {
      const tradeList = await db.getUserTrades(ctx.user.id, 1000);
      const header = "ID,Par,Lado,Precio,Cantidad,PnL,Estrategia,Simulado,Fecha";
      const rows = tradeList.map((t: any) => [
        t.id, t.symbol, t.side, t.price, t.qty, t.pnl ?? "0",
        t.strategy, t.simulated ? "Si" : "No",
        new Date(t.createdAt).toISOString(),
      ].join(","));
      return { csv: [header, ...rows].join("\n"), count: tradeList.length };
    }),
  }),

  opportunities: router({
    list: protectedProcedure.input(z.object({ limit: z.number().optional() }).optional()).query(async ({ ctx, input }) => {
      return db.getUserOpportunities(ctx.user.id, input?.limit ?? 50);
    }),
    unreadCount: protectedProcedure.query(async ({ ctx }) => {
      return db.getUnreadOpportunityCount(ctx.user.id);
    }),
  }),

  telegram: router({
    getConfig: protectedProcedure.query(async ({ ctx }) => {
      const key = await db.getApiKey(ctx.user.id, "telegram" as any);
      if (!key) return null;
      return { botToken: key.apiKey.slice(0, 6) + "..." + key.apiKey.slice(-4), chatId: key.apiSecret };
    }),
    saveConfig: protectedProcedure.input(z.object({
      botToken: z.string().min(1),
      chatId: z.string().min(1),
    })).mutation(async ({ ctx, input }) => {
      await db.saveApiKey(ctx.user.id, {
        apiKey: input.botToken,
        apiSecret: input.chatId,
        exchange: "telegram" as any,
        label: "Telegram Notifications",
      });
      return { success: true };
    }),
    testNotification: protectedProcedure.mutation(async ({ ctx }) => {
      const key = await db.getApiKey(ctx.user.id, "telegram" as any);
      if (!key) return { success: false, error: "No Telegram config" };
      try {
        const url = `https://api.telegram.org/bot${key.apiKey}/sendMessage`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: key.apiSecret,
            text: "\u2705 PHANTOM Bot conectado correctamente!",
            parse_mode: "HTML",
          }),
        });
        const data = await res.json() as any;
        return { success: data.ok ?? false };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }),
  }),

  ai: router({
    analyze: protectedProcedure.input(z.object({
      type: z.enum(["market_overview", "asset_analysis", "risk_assessment", "smart_opportunities"]),
    })).mutation(async ({ ctx, input }) => {
      const prompts: Record<string, string> = {
        market_overview: "You are PHANTOM, an elite AI trading analyst. Provide a concise market overview covering: 1) Overall crypto market sentiment (bullish/bearish/neutral), 2) Key BTC and ETH price levels, 3) SP500 outlook, 4) Top 3 market-moving events today. Be specific with numbers and actionable. Format with markdown headers and bullet points. End with a SENTIMENT: bullish/bearish/neutral line.",
        asset_analysis: "You are PHANTOM, an elite AI trading analyst. Provide deep analysis of BTC/USDT, ETH/USDT, and SP500: 1) Current trend direction and strength, 2) Key support/resistance levels, 3) RSI and MACD signals, 4) Volume analysis, 5) Short-term price targets. Be specific. Format with markdown. End with SENTIMENT: bullish/bearish/neutral.",
        risk_assessment: "You are PHANTOM, an elite AI risk analyst. Evaluate current portfolio risks: 1) Market volatility assessment, 2) Correlation risks between BTC, ETH, SP500, 3) Liquidity risks, 4) Recommended position sizing, 5) Stop-loss recommendations. Format with markdown. End with SENTIMENT: bullish/bearish/neutral.",
        smart_opportunities: "You are PHANTOM, an elite AI opportunity scanner. Identify the top 5 trading opportunities right now across crypto and TradFi: 1) Symbol and direction (LONG/SHORT), 2) Entry price range, 3) Target price, 4) Stop loss, 5) Risk/reward ratio, 6) Confidence percentage. Focus on high-probability setups. Format with markdown. End with SENTIMENT: bullish/bearish/neutral.",
      };
      const titles: Record<string, string> = {
        market_overview: "Market Overview",
        asset_analysis: "Asset Analysis — BTC, ETH, SP500",
        risk_assessment: "Risk Assessment",
        smart_opportunities: "Smart Opportunities",
      };
      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: prompts[input.type] },
            { role: "user", content: `Provide your analysis as of ${new Date().toISOString()}. Current date context: April 2026.` },
          ],
        });
        const content = typeof response.choices?.[0]?.message?.content === "string"
          ? response.choices[0].message.content
          : "Analysis unavailable.";
        const sentimentMatch = content.match(/SENTIMENT:\s*(bullish|bearish|neutral)/i);
        const sentiment = sentimentMatch ? sentimentMatch[1].toLowerCase() : "neutral";
        await db.insertAnalysis({
          userId: ctx.user.id,
          type: input.type,
          title: titles[input.type],
          content,
          sentiment,
        });
        return { content, sentiment, title: titles[input.type] };
      } catch (e: any) {
        return { content: "AI analysis temporarily unavailable. Please try again.", sentiment: "neutral", title: titles[input.type] };
      }
    }),
     history: protectedProcedure.query(async ({ ctx }) => {
      return db.getUserAnalyses(ctx.user.id);
    }),
  }),

  intelligence: router({
    // Fear & Greed Index — real-time market emotion
    fearGreed: protectedProcedure.query(async () => {
      const fg = await fetchFearGreedIndex();
      const signal = getFearGreedSignal(fg);
      return { data: fg, signal };
    }),

    // Sentiment Analysis for a specific symbol
    sentiment: protectedProcedure.input(z.object({ symbol: z.string() })).query(async ({ input }) => {
      return analyzeSentiment(input.symbol);
    }),

    // AI Learning Insights — what the bot has learned
    learningInsights: protectedProcedure.query(() => {
      return getLearningInsights();
    }),

    // Auto-Optimizer current parameters
    optimizerState: protectedProcedure.query(() => {
      const tuning = autoTuneParameters();
      return tuning;
    }),

    // Performance Report — comprehensive analytics
    performanceReport: protectedProcedure.query(() => {
      return generatePerformanceReport();
    }),

    // Full AI dashboard data — aggregated for frontend
    dashboard: protectedProcedure.query(async () => {
      const [fg, insights, tuning, perfReport] = await Promise.all([
        fetchFearGreedIndex(),
        Promise.resolve(getLearningInsights()),
        Promise.resolve(autoTuneParameters()),
        Promise.resolve(generatePerformanceReport()),
      ]);
      const fgSignal = getFearGreedSignal(fg);
      const prices = getLivePrices();
      return {
        fearGreed: { data: fg, signal: fgSignal },
        learning: insights,
        optimizer: tuning,
        performance: perfReport,
        livePrices: prices,
        timestamp: Date.now(),
      };
    }),
  }),
});
export type AppRouter = typeof appRouter;
