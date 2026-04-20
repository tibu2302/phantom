import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { ENV } from "./env";
import { verifyLocalSession } from "../localAuth";
import * as db from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    if (ENV.authMode === "local") {
      // Modo VPS: autenticación local con usuario/contraseña
      const cookies = opts.req.headers.cookie ?? "";
      const match = cookies.match(/app_session_id=([^;]+)/);
      const session = await verifyLocalSession(match?.[1]);
      if (session) {
        user = (await db.getUserByOpenId(session.openId)) ?? null;
      }
    } else {
      // Modo Manus: OAuth de Manus
      user = await sdk.authenticateRequest(opts.req);
    }
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
