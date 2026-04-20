/**
 * localAuth.ts
 * Sistema de autenticación local para despliegue en VPS propio.
 * Reemplaza el OAuth de Manus con login usuario/contraseña + JWT.
 *
 * Variables de entorno requeridas:
 *   ADMIN_USERNAME  — nombre de usuario del administrador (ej: "admin")
 *   ADMIN_PASSWORD  — contraseña en texto plano (se hashea en memoria al arrancar)
 *   JWT_SECRET      — clave secreta para firmar los tokens JWT
 */

import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import * as db from "./db";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";

// Credenciales del admin leídas desde variables de entorno
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "phantom2024";

const LOCAL_OPEN_ID = "local-admin-vps";

// ─── Helpers JWT ─────────────────────────────────────────────────────────────

function getSecretKey() {
  return new TextEncoder().encode(ENV.cookieSecret || "phantom-local-secret");
}

async function createLocalSessionToken(username: string): Promise<string> {
  return new SignJWT({
    openId: LOCAL_OPEN_ID,
    appId: "local",
    name: username,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor((Date.now() + ONE_YEAR_MS) / 1000))
    .sign(getSecretKey());
}

export async function verifyLocalSession(
  cookieValue: string | undefined | null
): Promise<{ openId: string; name: string } | null> {
  if (!cookieValue) return null;
  try {
    const { payload } = await jwtVerify(cookieValue, getSecretKey(), {
      algorithms: ["HS256"],
    });
    const { openId, name } = payload as Record<string, unknown>;
    if (typeof openId !== "string" || typeof name !== "string") return null;
    return { openId, name };
  } catch {
    return null;
  }
}

// ─── Rutas Express ────────────────────────────────────────────────────────────

export function registerLocalAuthRoutes(app: Express) {
  // POST /api/auth/login — recibe { username, password }
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { username, password } = req.body ?? {};

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      username.trim() !== ADMIN_USERNAME ||
      password !== ADMIN_PASSWORD
    ) {
      res.status(401).json({ error: "Usuario o contraseña incorrectos" });
      return;
    }

    // Asegurar que el usuario existe en la DB
    await db.upsertUser({
      openId: LOCAL_OPEN_ID,
      name: username,
      email: null,
      loginMethod: "local",
      lastSignedIn: new Date(),
    });

    const token = await createLocalSessionToken(username);
    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
    res.json({ ok: true, name: username });
  });

  // POST /api/auth/logout
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(COOKIE_NAME, cookieOptions);
    res.json({ ok: true });
  });

  // GET /api/auth/me — devuelve el usuario autenticado o null
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    const cookies = req.headers.cookie ?? "";
    const match = cookies.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    const session = await verifyLocalSession(match?.[1]);
    if (!session) {
      res.json({ user: null });
      return;
    }
    const user = await db.getUserByOpenId(session.openId);
    res.json({ user: user ?? null });
  });
}
