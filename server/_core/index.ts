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


// ─── Auto-Start Engine on Server Boot (v10.6: always start in LIVE mode) ───
setTimeout(async () => {
  try {
    const { startEngine } = await import("../tradingEngine");
    const { getUserByOpenId, getOrCreateBotState, getApiKey } = await import("../db");
    const { ENV } = await import("./env");
    
    if (ENV.ownerOpenId) {
      const owner = await getUserByOpenId(ENV.ownerOpenId);
      if (owner) {
        // v10.6: Check if API keys exist — if yes, force LIVE mode
        const bybitKeys = await getApiKey(owner.id, "bybit");
        if (bybitKeys) {
          // Force simulation mode OFF so the bot trades for real
          const { updateBotState } = await import("../db");
          await updateBotState(owner.id, { simulationMode: false });
          console.log(`[AutoStart] Forced LIVE mode (API keys found for owner ${owner.id})`);
        }

        // v11.0: BEAST MODE — Seed 4 assets × 3 strategies = 12 strategies
        const { getUserStrategies, upsertStrategy } = await import("../db");
        const existingStrats = await getUserStrategies(owner.id);
        const concentratedStrats = [
          // Grid: BTC, ETH, SP500
          { symbol: "BTCUSDT", strategyType: "grid", market: "crypto", category: "linear", allocationPct: 40, enabled: true },
          { symbol: "ETHUSDT", strategyType: "grid", market: "crypto", category: "linear", allocationPct: 40, enabled: true },
          { symbol: "SP500USDT", strategyType: "grid", market: "tradfi", category: "linear", allocationPct: 30, enabled: true },
          // Scalping: XAU, BTC, ETH, SP500
          { symbol: "XAUUSDT", strategyType: "scalping", market: "tradfi", category: "linear", allocationPct: 50, enabled: true },
          { symbol: "BTCUSDT", strategyType: "scalping", market: "crypto", category: "linear", allocationPct: 30, enabled: true },
          { symbol: "ETHUSDT", strategyType: "scalping", market: "crypto", category: "linear", allocationPct: 30, enabled: true },
          { symbol: "SP500USDT", strategyType: "scalping", market: "tradfi", category: "linear", allocationPct: 25, enabled: true },
          // Futures: XAU, BTC, ETH, SP500
          { symbol: "XAUUSDT", strategyType: "futures", market: "tradfi", category: "linear", allocationPct: 35, enabled: true, config: { leverage: 5, takeProfitPct: 1.2 } },
          { symbol: "BTCUSDT", strategyType: "futures", market: "crypto", category: "linear", allocationPct: 30, enabled: true, config: { leverage: 5, takeProfitPct: 1.2 } },
          { symbol: "ETHUSDT", strategyType: "futures", market: "crypto", category: "linear", allocationPct: 30, enabled: true, config: { leverage: 5, takeProfitPct: 1.2 } },
          { symbol: "SP500USDT", strategyType: "futures", market: "tradfi", category: "linear", allocationPct: 20, enabled: true, config: { leverage: 3, takeProfitPct: 1.5 } },
        ];
        const allowedKeys = new Set(concentratedStrats.map(s => `${s.symbol}_${s.strategyType}`));
        for (const existing of existingStrats) {
          const key = `${existing.symbol}_${existing.strategyType}`;
          if (!allowedKeys.has(key) && existing.enabled) {
            await upsertStrategy(owner.id, { ...existing, enabled: false } as any);
            console.log(`[AutoStart] v11.0: DISABLED ${existing.strategyType} ${existing.symbol}`);
          }
        }
        for (const strat of concentratedStrats) {
          await upsertStrategy(owner.id, strat as any);
        }
        console.log(`[AutoStart] v11.0: Synced ${concentratedStrats.length} BEAST MODE strategies (XAU+BTC+ETH+SP500)`);

        console.log(`[AutoStart] Starting engine for owner (id=${owner.id})...`);
        const result = await startEngine(owner.id);
        console.log(`[AutoStart] ${result.success ? 'Engine started successfully in LIVE mode' : 'Failed: ' + result.error}`);
      } else {
        console.log(`[AutoStart] Owner not found in DB, skipping`);
      }
    }
  } catch (e) {
    console.error("[AutoStart] Failed:", (e as Error).message);
  }
}, 15_000);
