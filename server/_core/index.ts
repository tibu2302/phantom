import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { ENV } from "./env";
import { registerLocalAuthRoutes } from "../localAuth";
import { registerReportRoutes } from "../dailyReport";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);

  // Registrar rutas de autenticación según el modo configurado
  if (ENV.authMode === "local") {
    console.log("[Auth] Running in LOCAL mode (username/password)");
    registerLocalAuthRoutes(app);
  } else {
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl || "https://api.manus.im");
    registerOAuthRoutes(app);
  }

  // PDF Report routes
  registerReportRoutes(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    const { serveStatic } = await import("./vite");
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);


// ─── Auto-Start Engine on Server Boot (v12.0: BTC+ETH+SOL+XAU, Grid+Scalping only) ───
setTimeout(async () => {
  try {
    const { startEngine } = await import("../tradingEngine");
    const { getUserByOpenId, getOrCreateBotState, getApiKey } = await import("../db");
    const { ENV } = await import("./env");
    
    if (ENV.ownerOpenId) {
      const owner = await getUserByOpenId(ENV.ownerOpenId);
      if (owner) {
        // Check if API keys exist — if yes, force LIVE mode
        const bybitKeys = await getApiKey(owner.id, "bybit");
        if (bybitKeys) {
          const { updateBotState } = await import("../db");
          await updateBotState(owner.id, { simulationMode: false });
          console.log(`[AutoStart] Forced LIVE mode (API keys found for owner ${owner.id})`);
        }

        // v12.0: Concentrated strategies — BTC+ETH+SOL+XAU × Grid+Scalping
        const { getUserStrategies, upsertStrategy } = await import("../db");
        const existingStrats = await getUserStrategies(owner.id);
        const v12Strategies = [
          // Grid: BTC, ETH, SOL
          { symbol: "BTCUSDT", strategyType: "grid", market: "crypto", category: "linear", allocationPct: 35, enabled: true },
          { symbol: "ETHUSDT", strategyType: "grid", market: "crypto", category: "linear", allocationPct: 30, enabled: true },
          { symbol: "SOLUSDT", strategyType: "grid", market: "crypto", category: "linear", allocationPct: 25, enabled: true },
          // Scalping: XAU, BTC, ETH, SOL
          { symbol: "XAUUSDT", strategyType: "scalping", market: "tradfi", category: "linear", allocationPct: 40, enabled: true },
          { symbol: "BTCUSDT", strategyType: "scalping", market: "crypto", category: "linear", allocationPct: 25, enabled: true },
          { symbol: "ETHUSDT", strategyType: "scalping", market: "crypto", category: "linear", allocationPct: 20, enabled: true },
          { symbol: "SOLUSDT", strategyType: "scalping", market: "crypto", category: "linear", allocationPct: 20, enabled: true },
        ];

        // Disable any strategy not in v12.0 list (removes SP500, futures, old coins)
        const allowedKeys = new Set(v12Strategies.map(s => `${s.symbol}_${s.strategyType}`));
        for (const existing of existingStrats) {
          const key = `${existing.symbol}_${existing.strategyType}`;
          if (!allowedKeys.has(key) && existing.enabled) {
            await upsertStrategy(owner.id, { ...existing, enabled: false } as any);
            console.log(`[AutoStart] v12.0: DISABLED ${existing.strategyType} ${existing.symbol}`);
          }
        }
        for (const strat of v12Strategies) {
          await upsertStrategy(owner.id, strat as any);
        }
        console.log(`[AutoStart] v12.0: Synced ${v12Strategies.length} strategies (BTC+ETH+SOL+XAU × Grid+Scalping)`);

        console.log(`[AutoStart] Starting engine for owner (id=${owner.id})...`);
        const botState = await getOrCreateBotState(owner.id);
        const telegramKeys = await getApiKey(owner.id, "telegram" as any);
        const result = await startEngine(owner.id, {
          exchange: "bybit",
          apiKey: bybitKeys?.apiKey ?? "",
          apiSecret: bybitKeys?.apiSecret ?? "",
          simulationMode: botState?.simulationMode ?? !bybitKeys,
          telegramBotToken: telegramKeys?.apiKey ?? undefined,
          telegramChatId: telegramKeys?.apiSecret ?? undefined,
        });
        console.log(`[AutoStart] ${result.success ? 'Engine v12.0 started in LIVE mode' : 'Failed'}`);
      } else {
        console.log(`[AutoStart] Owner not found in DB, skipping`);
      }
    }
  } catch (e) {
    console.error("[AutoStart] Failed:", (e as Error).message);
  }
}, 15_000);
