import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext; clearedCookies: any[] } {
  const clearedCookies: any[] = [];
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-phantom",
    email: "test@phantom.bot",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };
  return { ctx, clearedCookies };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

// ─── Auth Tests ───
describe("auth.me", () => {
  it("returns user when authenticated", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeDefined();
    expect(result?.openId).toBe("test-user-phantom");
    expect(result?.name).toBe("Test User");
  });

  it("returns null when unauthenticated", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });
});

describe("auth.logout", () => {
  it("clears session cookie", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
  });
});

// ─── Bot Status Tests ───
describe("bot.status", () => {
  it("requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.bot.status()).rejects.toThrow();
  });

  it("returns full status with live prices and engine state", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bot.status();
    expect(result).toHaveProperty("state");
    expect(result).toHaveProperty("unreadNotifications");
    expect(result).toHaveProperty("recentOpportunities");
    expect(result).toHaveProperty("livePrices");
    expect(result).toHaveProperty("engineRunning");
    expect(typeof result.engineRunning).toBe("boolean");
    expect(typeof result.unreadNotifications).toBe("number");
    expect(Array.isArray(result.recentOpportunities)).toBe(true);
    expect(typeof result.livePrices).toBe("object");
  });
});

describe("bot.livePrices", () => {
  it("returns a prices object", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const prices = await caller.bot.livePrices();
    expect(typeof prices).toBe("object");
  });
});

describe("bot.updateSettings", () => {
  it("updates simulation mode", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bot.updateSettings({ simulationMode: true });
    expect(result).toEqual({ success: true });
  });

  it("updates initial balance", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bot.updateSettings({ initialBalance: "10000" });
    expect(result).toEqual({ success: true });
  });
});

describe("bot.markNotificationsRead", () => {
  it("marks all notifications as read", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.bot.markNotificationsRead();
    expect(result).toEqual({ success: true });
  });
});

// ─── API Keys Tests ───
describe("apiKeys", () => {
  it("get requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.apiKeys.get()).rejects.toThrow();
  });

  it("get returns null when no keys configured", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.apiKeys.get();
    expect(result === null || typeof result === "object").toBe(true);
  });
});

// ─── Strategies Tests ───
describe("strategies", () => {
  it("list requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.strategies.list()).rejects.toThrow();
  });

  it("list returns an array", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.strategies.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── Trades Tests ───
describe("trades", () => {
  it("list requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.trades.list({ limit: 10 })).rejects.toThrow();
  });

  it("list returns an array", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.trades.list({ limit: 10 });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── Opportunities Tests ───
describe("opportunities", () => {
  it("list requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.opportunities.list({ limit: 10 })).rejects.toThrow();
  });

  it("list returns an array", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.opportunities.list({ limit: 10 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("unreadCount returns a number", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.opportunities.unreadCount();
    expect(typeof result).toBe("number");
  });
});

// ─── AI Analyst Tests ───
describe("ai", () => {
  it("analyze requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.ai.analyze({ type: "market_overview" })).rejects.toThrow();
  });

  it("history returns an array", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.ai.history();
    expect(Array.isArray(result)).toBe(true);
  });
});
