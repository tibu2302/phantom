import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { invokeLLM } from "./_core/llm";
import { startEngine, stopEngine, emergencyStopEngine, getLivePrices, isEngineRunning } from "./tradingEngine";

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
      return {
        state,
        unreadNotifications: unread,
        recentOpportunities: recentOpps,
        livePrices: prices,
        engineRunning,
      };
    }),
    start: protectedProcedure.mutation(async ({ ctx }) => {
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
    })).mutation(async ({ ctx, input }) => {
      const data: Record<string, unknown> = {};
      if (input.simulationMode !== undefined) data.simulationMode = input.simulationMode;
      if (input.initialBalance !== undefined) {
        data.initialBalance = input.initialBalance;
        data.currentBalance = input.initialBalance;
      }
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
  }),

  apiKeys: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const key = await db.getApiKey(ctx.user.id);
      if (!key) return null;
      return { id: key.id, label: key.label, apiKey: key.apiKey.slice(0, 6) + "..." + key.apiKey.slice(-4), hasSecret: true, createdAt: key.createdAt };
    }),
    save: protectedProcedure.input(z.object({
      apiKey: z.string().min(1),
      apiSecret: z.string().min(1),
      label: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      await db.saveApiKey(ctx.user.id, input);
      const existingStrategies = await db.getUserStrategies(ctx.user.id);
      if (existingStrategies.length === 0) {
        await db.upsertStrategy(ctx.user.id, { symbol: "BTCUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 40 });
        await db.upsertStrategy(ctx.user.id, { symbol: "ETHUSDT", strategyType: "grid", market: "crypto", category: "spot", allocationPct: 30 });
        await db.upsertStrategy(ctx.user.id, { symbol: "SPXUSDT", strategyType: "scalping", market: "tradfi", category: "linear", allocationPct: 30 });
      }
      return { success: true };
    }),
    delete: protectedProcedure.mutation(async ({ ctx }) => {
      await db.deleteApiKey(ctx.user.id);
      return { success: true };
    }),
    testConnection: protectedProcedure.mutation(async ({ ctx }) => {
      const keys = await db.getApiKey(ctx.user.id);
      if (!keys) return { success: false, error: "No API keys configured" };
      try {
        const { RestClientV5 } = await import("bybit-api");
        const client = new RestClientV5({ key: keys.apiKey, secret: keys.apiSecret });
        const res = await client.getWalletBalance({ accountType: "UNIFIED" });
        if (res.retCode === 0) {
          const coins = (res.result as any)?.list?.[0]?.coin ?? [];
          const totalUsd = (res.result as any)?.list?.[0]?.totalEquity ?? "0";
          return { success: true, balance: totalUsd, coins: coins.length };
        }
        return { success: false, error: res.retMsg || "Connection failed" };
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
  }),

  trades: router({
    list: protectedProcedure.input(z.object({ limit: z.number().optional() }).optional()).query(async ({ ctx, input }) => {
      return db.getUserTrades(ctx.user.id, input?.limit ?? 50);
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
