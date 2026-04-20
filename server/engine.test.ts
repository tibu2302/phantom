import { describe, expect, it, afterAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { stopEngine, getLivePrices, isEngineRunning, getEngineCycles } from "./tradingEngine";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

const TEST_USER_ID = 999;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: TEST_USER_ID,
    openId: "test-engine-user",
    email: "engine@phantom.bot",
    name: "Engine Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
  return { ctx };
}

afterAll(async () => {
  await stopEngine(TEST_USER_ID);
});

describe("Trading Engine Integration", () => {
  it("bot.start seeds strategies and starts engine", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bot.start();
    expect(result.success).toBe(true);
  }, 15000);

  it("engine is running after bot.start", () => {
    expect(isEngineRunning(TEST_USER_ID)).toBe(true);
  });

  it("cycle counter initializes to 0", () => {
    const cycles = getEngineCycles(TEST_USER_ID);
    expect(typeof cycles).toBe("number");
    expect(cycles).toBeGreaterThanOrEqual(0);
  });

  it("live prices object is available", async () => {
    // Wait for background price feed to load
    await new Promise(r => setTimeout(r, 2000));
    const prices = getLivePrices();
    expect(typeof prices).toBe("object");
    // At minimum, SP500 should load quickly via Yahoo Finance
    // Bybit prices may take longer due to rate limiting in test environment
    const keys = Object.keys(prices);
    expect(keys.length).toBeGreaterThan(0);
  });

  it("strategies are seeded with XAUUSDT (not SPXUSDT)", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const strategies = await caller.strategies.list();
    expect(Array.isArray(strategies)).toBe(true);
    expect(strategies.length).toBeGreaterThanOrEqual(3);
    const symbols = strategies.map((s: any) => s.symbol);
    expect(symbols).toContain("BTCUSDT");
    expect(symbols).toContain("ETHUSDT");
    expect(symbols).toContain("XAUUSDT");
    expect(symbols).not.toContain("SPXUSDT");
  });

  it("bot.status returns cycles and engine state", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const status = await caller.bot.status();
    expect(status.engineRunning).toBe(true);
    expect(typeof status.cycles).toBe("number");
    expect(status.livePrices).toBeDefined();
    expect(typeof status.livePrices).toBe("object");
  });

  it("trades list returns valid array structure", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const trades = await caller.trades.list({ limit: 50 });
    expect(Array.isArray(trades)).toBe(true);
    // Trades may or may not exist depending on market conditions during test
    if (trades.length > 0) {
      const t = trades[0] as any;
      expect(t).toHaveProperty("symbol");
      expect(t).toHaveProperty("side");
      expect(t).toHaveProperty("price");
      expect(t).toHaveProperty("strategy");
    }
  });

  it("opportunities list returns valid array structure", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const opps = await caller.opportunities.list({ limit: 50 });
    expect(Array.isArray(opps)).toBe(true);
    if (opps.length > 0) {
      const o = opps[0] as any;
      expect(o).toHaveProperty("symbol");
      expect(o).toHaveProperty("signal");
      expect(o).toHaveProperty("confidence");
    }
  });

  it("bot.stop stops the engine", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bot.stop();
    expect(result.success).toBe(true);
    expect(isEngineRunning(TEST_USER_ID)).toBe(false);
  }, 10000);

  it("emergency stop works", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await caller.bot.start();
    expect(isEngineRunning(TEST_USER_ID)).toBe(true);
    const result = await caller.bot.emergencyStop();
    expect(result.success).toBe(true);
    expect(isEngineRunning(TEST_USER_ID)).toBe(false);
  }, 15000);
});
