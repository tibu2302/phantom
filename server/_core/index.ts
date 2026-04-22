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


// ─── Auto-Start Engine on Server Boot ───
setTimeout(async () => {
  try {
    const { startEngine } = await import("../tradingEngine");
    const { getUserByOpenId, getOrCreateBotState } = await import("../db");
    const { ENV } = await import("./env");
    
    if (ENV.ownerOpenId) {
      const owner = await getUserByOpenId(ENV.ownerOpenId);
      if (owner) {
        const state = await getOrCreateBotState(owner.id);
        if (state && !state.simulationMode) {
          console.log(`[AutoStart] Owner (id=${owner.id}) was in LIVE mode, auto-starting engine...`);
          const result = await startEngine(owner.id);
          console.log(`[AutoStart] ${result.success ? 'Engine started successfully' : 'Failed: ' + result.error}`);
        } else {
          console.log(`[AutoStart] Owner in simulation mode, skipping auto-start`);
        }
      }
    }
  } catch (e) {
    console.error("[AutoStart] Failed:", (e as Error).message);
  }
}, 15_000);
