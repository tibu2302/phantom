import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { invokeLLM } from "./_core/llm";
import {
  saveApiKey, getApiKey, deleteApiKey,
  getOrCreateBotState, updateBotState,
  getStrategies, initDefaultStrategies, updateStrategy,
  getRecentTrades, getPnlHistory,
  getOpportunities, getUnreadOpportunityCount, markOpportunitiesRead,
  getAiAnalyses, saveAiAnalysis,
  getPrices,
} from "./db";

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

  apiKeys: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const key = await getApiKey(ctx.user.id);
      if (!key) return null;
      return {
        id: key.id,
        exchange: key.exchange,
        apiKey: key.apiKey.slice(0, 6) + "..." + key.apiKey.slice(-4),
        label: key.label,
        hasSecret: true,
        createdAt: key.createdAt,
      };
    }),
    save: protectedProcedure.input(z.object({
      apiKey: z.string().min(5),
      apiSecret: z.string().min(5),
      label: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      await saveApiKey(ctx.user.id, input.apiKey, input.apiSecret, input.label);
      await initDefaultStrategies(ctx.user.id);
      return { success: true };
    }),
    delete: protectedProcedure.mutation(async ({ ctx }) => {
      await deleteApiKey(ctx.user.id);
      return { success: true };
    }),
  }),

  bot: router({
    status: protectedProcedure.query(async ({ ctx }) => {
      const state = await getOrCreateBotState(ctx.user.id);
      const strats = await getStrategies(ctx.user.id);
      const prices = await getPrices();
      const unreadCount = await getUnreadOpportunityCount(ctx.user.id);
      return { state, strategies: strats, prices, unreadAlerts: unreadCount };
    }),
    start: protectedProcedure.mutation(async ({ ctx }) => {
      await getOrCreateBotState(ctx.user.id);
      await initDefaultStrategies(ctx.user.id);
      await updateBotState(ctx.user.id, { status: "running", startedAt: new Date() });
      return { success: true };
    }),
    stop: protectedProcedure.mutation(async ({ ctx }) => {
      await updateBotState(ctx.user.id, { status: "stopped" });
      return { success: true };
    }),
    emergency: protectedProcedure.mutation(async ({ ctx }) => {
      await updateBotState(ctx.user.id, { status: "stopped" });
      return { success: true, message: "Emergency stop executed. All operations halted." };
    }),
    updateConfig: protectedProcedure.input(z.object({
      simulationMode: z.boolean().optional(),
      initialBalance: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      await updateBotState(ctx.user.id, input);
      return { success: true };
    }),
  }),

  strategies: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getStrategies(ctx.user.id);
    }),
    toggle: protectedProcedure.input(z.object({
      id: z.number(),
      enabled: z.boolean(),
    })).mutation(async ({ input }) => {
      await updateStrategy(input.id, { enabled: input.enabled });
      return { success: true };
    }),
  }),

  trades: router({
    recent: protectedProcedure.input(z.object({ limit: z.number().optional() }).optional()).query(async ({ ctx, input }) => {
      return getRecentTrades(ctx.user.id, input?.limit || 50);
    }),
  }),

  pnl: router({
    history: protectedProcedure.input(z.object({ limit: z.number().optional() }).optional()).query(async ({ ctx, input }) => {
      return getPnlHistory(ctx.user.id, input?.limit || 100);
    }),
  }),

  opportunities: router({
    list: protectedProcedure.input(z.object({ limit: z.number().optional() }).optional()).query(async ({ ctx, input }) => {
      return getOpportunities(ctx.user.id, input?.limit || 50);
    }),
    unreadCount: protectedProcedure.query(async ({ ctx }) => {
      return getUnreadOpportunityCount(ctx.user.id);
    }),
    markRead: protectedProcedure.mutation(async ({ ctx }) => {
      await markOpportunitiesRead(ctx.user.id);
      return { success: true };
    }),
  }),

  ai: router({
    analyses: protectedProcedure.input(z.object({ limit: z.number().optional() }).optional()).query(async ({ ctx, input }) => {
      return getAiAnalyses(ctx.user.id, input?.limit || 20);
    }),
    analyze: protectedProcedure.input(z.object({
      type: z.enum(["market_overview", "coin_analysis", "risk_assessment", "opportunity"]),
      symbols: z.array(z.string()).optional(),
      context: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      const prices = await getPrices();
      const strats = await getStrategies(ctx.user.id);
      const state = await getOrCreateBotState(ctx.user.id);
      const priceInfo = prices.map(p => `${p.symbol}: $${p.price} (${Number(p.change24h) >= 0 ? "+" : ""}${p.change24h}%)`).join(", ");
      const stratInfo = strats.map(s => `${s.symbol} (${s.strategyType}/${s.market}): PnL $${s.pnl}, ${s.trades} trades`).join("; ");
      const prompts: Record<string, string> = {
        market_overview: `You are an elite AI market analyst for a trading bot. Analyze the current market conditions.\n\nCurrent prices: ${priceInfo}\nActive strategies: ${stratInfo}\nBot PnL: $${state?.totalPnl || 0}\n\nProvide a concise market overview covering: 1) Overall market sentiment 2) Key trends 3) Risk factors 4) Actionable recommendations. Be specific with numbers and percentages. Keep it under 300 words. Use markdown formatting.`,
        coin_analysis: `You are an elite AI trading analyst. Analyze these specific assets: ${input.symbols?.join(", ") || "BTC, ETH, SP500"}.\n\nCurrent prices: ${priceInfo}\n\nFor each asset provide: 1) Current trend direction 2) Key support/resistance levels 3) Technical signals 4) Buy/Sell/Hold recommendation with confidence %. Keep it under 400 words. Use markdown.`,
        risk_assessment: `You are an AI risk manager for a trading bot.\n\nBot state: PnL $${state?.totalPnl || 0}, ${state?.totalTrades || 0} trades, Drawdown ${state?.maxDrawdown || 0}%, Daily loss $${state?.dailyLoss || 0}\nStrategies: ${stratInfo}\n\nAssess: 1) Current risk exposure 2) Portfolio concentration risks 3) Recommended position adjustments 4) Risk score (1-10). Keep under 250 words. Use markdown.`,
        opportunity: `You are an AI opportunity scanner for crypto and TradFi markets.\n\nCurrent prices: ${priceInfo}\n${input.context || ""}\n\nIdentify the top 3 trading opportunities right now. For each: 1) Asset and direction 2) Entry price range 3) Target and stop loss 4) Confidence % 5) Reasoning. Keep under 350 words. Use markdown.`,
      };
      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are the world's most intelligent AI trading analyst. Provide precise, actionable analysis. Always include specific numbers. Format with markdown." },
            { role: "user", content: prompts[input.type] || prompts.market_overview },
          ],
        });
        const rawContent = response.choices?.[0]?.message?.content;
        const content = typeof rawContent === "string" ? rawContent : "Analysis unavailable at this time.";
        const sentimentMatch = content.toLowerCase() as string;
        const sentiment = sentimentMatch.includes("bullish") || sentimentMatch.includes("uptrend") ? "bullish" as const
          : sentimentMatch.includes("bearish") || sentimentMatch.includes("downtrend") ? "bearish" as const
          : "neutral" as const;
        const titles: Record<string, string> = {
          market_overview: "Market Overview",
          coin_analysis: `Analysis: ${input.symbols?.join(", ") || "BTC, ETH, SP500"}`,
          risk_assessment: "Risk Assessment",
          opportunity: "Smart Opportunities",
        };
        await saveAiAnalysis({
          userId: ctx.user.id,
          analysisType: input.type,
          title: titles[input.type] || "Analysis",
          content,
          sentiment,
          symbols: input.symbols || [],
        });
        return { content, sentiment, title: titles[input.type] };
      } catch (error) {
        return { content: "AI analysis is temporarily unavailable. Please try again in a moment.", sentiment: "neutral" as const, title: "Error" };
      }
    }),
  }),

  prices: router({
    list: protectedProcedure.query(async () => {
      return getPrices();
    }),
  }),
});

export type AppRouter = typeof appRouter;
