import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { invokeLLM } from "./_core/llm";
import { startEngine, stopEngine, emergencyStopEngine, getLivePrices, isEngineRunning, getEngineCycles, getOpenPositions } from "./tradingEngine";

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
      // Force-sync: ALWAYS upsert all strategies with optimized values (overwrite existing)
      if (existingStrats.length > 0) {
        const defaultStrats: Array<{ symbol: string; strategyType: string; market: string; category: string; allocationPct: number; enabled: boolean; config?: any }> = [
          // Grid strategies (higher allocation for BTC/ETH)
          { symbol: "BTCUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 50, enabled: true },
          { symbol: "ETHUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 50, enabled: true },
          { symbol: "SOLUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 30, enabled: true },
          { symbol: "XRPUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 20, enabled: true },
          { symbol: "DOGEUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 15, enabled: true },
          { symbol: "ADAUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 15, enabled: true },
          { symbol: "AVAXUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 15, enabled: true },
          { symbol: "LINKUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 15, enabled: true },
          { symbol: "ARBUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 10, enabled: true },
          { symbol: "SUIUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 10, enabled: true },
          // Scalping (expanded: XAUUSDT + DOGE, ADA, LINK)
          { symbol: "XAUUSDT", strategyType: "scalping", market: "tradfi", category: "linear", allocationPct: 20, enabled: true },
          { symbol: "DOGEUSDT", strategyType: "scalping", market: "crypto", category: "spot", allocationPct: 15, enabled: true },
          { symbol: "ADAUSDT", strategyType: "scalping", market: "crypto", category: "spot", allocationPct: 15, enabled: true },
          { symbol: "LINKUSDT", strategyType: "scalping", market: "crypto", category: "spot", allocationPct: 15, enabled: true },
          // Futures (BTC/ETH 5x, SOL/XRP/AVAX 3x, TP 1.5%)
          { symbol: "BTCUSDT", strategyType: "futures", market: "crypto", category: "linear", allocationPct: 25, enabled: true, config: { leverage: 5, takeProfitPct: 1.5 } },
          { symbol: "ETHUSDT", strategyType: "futures", market: "crypto", category: "linear", allocationPct: 25, enabled: true, config: { leverage: 5, takeProfitPct: 1.5 } },
          { symbol: "SOLUSDT", strategyType: "futures", market: "crypto", category: "linear", allocationPct: 20, enabled: true, config: { leverage: 3, takeProfitPct: 1.5 } },
          { symbol: "XRPUSDT", strategyType: "futures", market: "crypto", category: "linear", allocationPct: 15, enabled: true, config: { leverage: 3, takeProfitPct: 1.5 } },
          { symbol: "AVAXUSDT", strategyType: "futures", market: "crypto", category: "linear", allocationPct: 15, enabled: true, config: { leverage: 3, takeProfitPct: 1.5 } },
          { symbol: "XAUUSDT", strategyType: "futures", market: "tradfi", category: "linear", allocationPct: 15, enabled: true, config: { leverage: 3, takeProfitPct: 1.5 } },
        ];
        let synced = 0;
        for (const strat of defaultStrats) {
          await db.upsertStrategy(ctx.user.id, strat as any);
          synced++;
        }
        console.log(`[Bot] Force-synced ${synced} strategies with optimized values for user ${ctx.user.id}`);
      }
      if (existingStrats.length === 0) {
        // Grid (higher allocation BTC/ETH)
        await db.upsertStrategy(ctx.user.id, { symbol: "BTCUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 50, enabled: true });
        await db.upsertStrategy(ctx.user.id, { symbol: "ETHUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 50, enabled: true });
        await db.upsertStrategy(ctx.user.id, { symbol: "SOLUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 30, enabled: true });
        await db.upsertStrategy(ctx.user.id, { symbol: "XRPUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 20, enabled: true });
        await db.upsertStrategy(ctx.user.id, { symbol: "DOGEUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 15, enabled: true });
        await db.upsertStrategy(ctx.user.id, { symbol: "ADAUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 15, enabled: true });
        await db.upsertStrategy(ctx.user.id, { symbol: "AVAXUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 15, enabled: true });
        await db.upsertStrategy(ctx.user.id, { symbol: "LINKUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 15, enabled: true });
        await db.upsertStrategy(ctx.user.id, { symbol: "ARBUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 10, enabled: true });
        await db.upsertStrategy(ctx.user.id, { symbol: "SUIUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 10, enabled: true });
        // Scalping (expanded)
        await db.upsertStrategy(ctx.user.id, { symbol: "XAUUSDT", strategyType: "scalping", market: "tradfi", category: "linear", allocationPct: 20, enabled: true });
        await db.upsertStrategy(ctx.user.id, { symbol: "DOGEUSDT", strategyType: "scalping", market: "crypto", category: "spot", allocationPct: 15, enabled: true });
        await db.upsertStrategy(ctx.user.id, { symbol: "ADAUSDT", strategyType: "scalping", market: "crypto", category: "spot", allocationPct: 15, enabled: true });
        await db.upsertStrategy(ctx.user.id, { symbol: "LINKUSDT", strategyType: "scalping", market: "crypto", category: "spot", allocationPct: 15, enabled: true });
        // Futures (BTC/ETH 5x, SOL/XRP/AVAX 3x, TP 1.5%)
        await db.upsertStrategy(ctx.user.id, { symbol: "BTCUSDT", strategyType: "futures", market: "crypto", category: "linear", allocationPct: 25, enabled: true, config: { leverage: 5, takeProfitPct: 1.5 } } as any);
        await db.upsertStrategy(ctx.user.id, { symbol: "ETHUSDT", strategyType: "futures", market: "crypto", category: "linear", allocationPct: 25, enabled: true, config: { leverage: 5, takeProfitPct: 1.5 } } as any);
        await db.upsertStrategy(ctx.user.id, { symbol: "SOLUSDT", strategyType: "futures", market: "crypto", category: "linear", allocationPct: 20, enabled: true, config: { leverage: 3, takeProfitPct: 1.5 } } as any);
        await db.upsertStrategy(ctx.user.id, { symbol: "XRPUSDT", strategyType: "futures", market: "crypto", category: "linear", allocationPct: 15, enabled: true, config: { leverage: 3, takeProfitPct: 1.5 } } as any);
        await db.upsertStrategy(ctx.user.id, { symbol: "AVAXUSDT", strategyType: "futures", market: "crypto", category: "linear", allocationPct: 15, enabled: true, config: { leverage: 3, takeProfitPct: 1.5 } } as any);
        await db.upsertStrategy(ctx.user.id, { symbol: "XAUUSDT", strategyType: "futures", market: "tradfi", category: "linear", allocationPct: 15, enabled: true, config: { leverage: 3, takeProfitPct: 1.5 } } as any);
        console.log(`[Bot] Seeded default strategies for user ${ctx.user.id}`);
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
      const results: { bybit?: { balance: string; error?: string }; kucoin?: { balance: string; error?: string } } = {};
      // Bybit balance
      try {
        const bybitKeys = await db.getApiKey(ctx.user.id, "bybit");
        if (bybitKeys) {
          const { RestClientV5 } = await import("bybit-api");
          const client = new RestClientV5({ key: bybitKeys.apiKey, secret: bybitKeys.apiSecret });
          const res = await client.getWalletBalance({ accountType: "UNIFIED" });
          if (res.retCode === 0) {
            const totalUsd = (res.result as any)?.list?.[0]?.totalEquity ?? "0";
            results.bybit = { balance: parseFloat(totalUsd).toFixed(2) };
          } else {
            results.bybit = { balance: "0", error: res.retMsg };
          }
        }
      } catch (e: any) {
        results.bybit = { balance: "0", error: e.message };
      }
      // KuCoin balance
      try {
        const kucoinKeys = await db.getApiKey(ctx.user.id, "kucoin");
        if (kucoinKeys) {
          const { SpotClient } = await import("kucoin-api");
          const client = new SpotClient({ apiKey: kucoinKeys.apiKey, apiSecret: kucoinKeys.apiSecret, apiPassphrase: kucoinKeys.passphrase ?? "" });
          const res = await client.getAccountSummary();
          if (res.code === "200000") {
            const summary = res.data as any;
            const totalUsd = parseFloat(summary?.totalBalance ?? summary?.availableBalance ?? "0");
            results.kucoin = { balance: totalUsd.toFixed(2) };
          } else {
            results.kucoin = { balance: "0", error: (res as any).msg };
          }
        }
      } catch (e: any) {
        results.kucoin = { balance: "0", error: e.message };
      }
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
        await db.upsertStrategy(ctx.user.id, { symbol: "XAUUSDT", strategyType: "scalping", market: "tradfi", category: "linear", allocationPct: 30 });
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
          const res = await client.getWalletBalance({ accountType: "UNIFIED" });
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
});

export type AppRouter = typeof appRouter;
