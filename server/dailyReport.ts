/**
 * dailyReport.ts — PHANTOM Daily Report PDF Generator
 * 
 * Generates a comprehensive PDF with:
 * - Header with PHANTOM branding and date
 * - Capital summary (initial, current, growth %)
 * - PnL breakdown by strategy and by coin
 * - Full trade log table
 * - Open positions at end of day
 * - Statistics: win rate, best/worst trade, total trades
 */
import PDFDocument from "pdfkit";
import type { Express, Request, Response } from "express";
import * as db from "./db";
import { trades, strategies, pnlHistory, botState, openPositions } from "../drizzle/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { COOKIE_NAME } from "@shared/const";
import { ENV } from "./_core/env";

// ─── Auth helper: extract userId from session cookie ───
async function getUserIdFromRequest(req: Request): Promise<number | null> {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (!cookie) return null;

  try {
    if (ENV.authMode === "local") {
      const { verifyLocalSession } = await import("./localAuth");
      const session = await verifyLocalSession(cookie);
      if (!session) return null;
      const user = await db.getUserByOpenId(session.openId);
      return user?.id ?? null;
    } else {
      // Manus OAuth — verify JWT
      const { jwtVerify } = await import("jose");
      const secret = new TextEncoder().encode(ENV.cookieSecret || "phantom-local-secret");
      const { payload } = await jwtVerify(cookie, secret, { algorithms: ["HS256"] });
      const openId = (payload as any).openId;
      if (!openId) return null;
      const user = await db.getUserByOpenId(openId);
      return user?.id ?? null;
    }
  } catch {
    return null;
  }
}

// ─── Helpers ───
function fmtMoney(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtTime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

// ─── Generate PDF ───
async function generateDailyReportPDF(userId: number, dateStr: string): Promise<Buffer> {
  const database = await db.getDb();
  if (!database) throw new Error("Database not available");

  // Parse date range
  const startDate = new Date(`${dateStr}T00:00:00.000Z`);
  const endDate = new Date(`${dateStr}T23:59:59.999Z`);

  // Fetch data
  const allTrades = await database.select().from(trades)
    .where(and(
      eq(trades.userId, userId),
      gte(trades.createdAt, startDate),
      lte(trades.createdAt, endDate)
    ))
    .orderBy(trades.createdAt);

  const userStrategies = await database.select().from(strategies)
    .where(eq(strategies.userId, userId));

  const state = await database.select().from(botState)
    .where(eq(botState.userId, userId)).limit(1);

  const pnlRows = await database.select().from(pnlHistory)
    .where(eq(pnlHistory.userId, userId))
    .orderBy(desc(pnlHistory.date))
    .limit(30);

  const positions = await database.select().from(openPositions)
    .where(eq(openPositions.userId, userId));

  // Calculate stats
  const botInfo = state[0] ?? null;
  const initialBalance = parseFloat(botInfo?.initialBalance ?? "5000");
  const currentBalance = parseFloat(botInfo?.currentBalance ?? "5000");
  const growthPct = initialBalance > 0 ? ((currentBalance - initialBalance) / initialBalance) * 100 : 0;

  const sellTrades = allTrades.filter(t => t.side === "sell");
  const buyTrades = allTrades.filter(t => t.side === "buy");
  const totalPnlToday = sellTrades.reduce((sum, t) => sum + parseFloat(t.pnl ?? "0"), 0);
  const winTrades = sellTrades.filter(t => parseFloat(t.pnl ?? "0") > 0);
  const lossTrades = sellTrades.filter(t => parseFloat(t.pnl ?? "0") < 0);
  const winRate = sellTrades.length > 0 ? (winTrades.length / sellTrades.length) * 100 : 0;
  const bestTrade = sellTrades.length > 0 ? Math.max(...sellTrades.map(t => parseFloat(t.pnl ?? "0"))) : 0;
  const worstTrade = sellTrades.length > 0 ? Math.min(...sellTrades.map(t => parseFloat(t.pnl ?? "0"))) : 0;

  // PnL by strategy
  const pnlByStrategy: Record<string, { pnl: number; trades: number; wins: number }> = {};
  for (const t of sellTrades) {
    const key = t.strategy ?? "unknown";
    if (!pnlByStrategy[key]) pnlByStrategy[key] = { pnl: 0, trades: 0, wins: 0 };
    pnlByStrategy[key].pnl += parseFloat(t.pnl ?? "0");
    pnlByStrategy[key].trades++;
    if (parseFloat(t.pnl ?? "0") > 0) pnlByStrategy[key].wins++;
  }

  // PnL by coin
  const pnlByCoin: Record<string, { pnl: number; trades: number; wins: number }> = {};
  for (const t of sellTrades) {
    const key = t.symbol;
    if (!pnlByCoin[key]) pnlByCoin[key] = { pnl: 0, trades: 0, wins: 0 };
    pnlByCoin[key].pnl += parseFloat(t.pnl ?? "0");
    pnlByCoin[key].trades++;
    if (parseFloat(t.pnl ?? "0") > 0) pnlByCoin[key].wins++;
  }

  // PnL history for chart (last 14 days)
  const pnlHistoryData = pnlRows.slice(0, 14).reverse();

  // ─── Build PDF ───
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width - 80; // usable width
    const leftMargin = 40;

    // ═══════════════════════════════════════════
    // HEADER
    // ═══════════════════════════════════════════
    doc.rect(0, 0, doc.page.width, 80).fill("#0a0a0a");
    doc.fill("#00ff88").fontSize(28).font("Helvetica-Bold").text("PHANTOM", leftMargin, 20);
    doc.fill("#888888").fontSize(10).font("Helvetica").text("Trading Intelligence", leftMargin, 52);
    doc.fill("#ffffff").fontSize(12).font("Helvetica-Bold").text(`Reporte Diario - ${dateStr}`, doc.page.width - 240, 30);
    doc.fill("#888888").fontSize(9).font("Helvetica").text(`Generado: ${fmtTime(new Date())}`, doc.page.width - 240, 50);

    doc.moveDown(3);
    let y = 100;

    // ═══════════════════════════════════════════
    // RESUMEN DE CAPITAL
    // ═══════════════════════════════════════════
    doc.fill("#00ff88").fontSize(14).font("Helvetica-Bold").text("RESUMEN DE CAPITAL", leftMargin, y);
    y += 25;

    // Box
    doc.rect(leftMargin, y, pageW, 60).lineWidth(0.5).stroke("#333333");
    const colW = pageW / 4;
    const labels = ["Capital Inicial", "Capital Actual", "Crecimiento", "PnL Hoy"];
    const values = [
      `$${initialBalance.toFixed(2)}`,
      `$${currentBalance.toFixed(2)}`,
      fmtPct(growthPct),
      fmtMoney(totalPnlToday)
    ];
    const colors = ["#ffffff", "#ffffff", growthPct >= 0 ? "#00ff88" : "#ff4444", totalPnlToday >= 0 ? "#00ff88" : "#ff4444"];

    for (let i = 0; i < 4; i++) {
      const x = leftMargin + colW * i + 10;
      doc.fill("#888888").fontSize(8).font("Helvetica").text(labels[i], x, y + 10, { width: colW - 20 });
      doc.fill(colors[i]).fontSize(16).font("Helvetica-Bold").text(values[i], x, y + 25, { width: colW - 20 });
    }
    y += 75;

    // ═══════════════════════════════════════════
    // ESTADÍSTICAS DEL DÍA
    // ═══════════════════════════════════════════
    doc.fill("#00ff88").fontSize(14).font("Helvetica-Bold").text("ESTADISTICAS DEL DIA", leftMargin, y);
    y += 25;

    doc.rect(leftMargin, y, pageW, 50).lineWidth(0.5).stroke("#333333");
    const statLabels = ["Total Trades", "Win Rate", "Mejor Trade", "Peor Trade", "Compras", "Ventas"];
    const statValues = [
      `${allTrades.length}`,
      `${winRate.toFixed(1)}%`,
      fmtMoney(bestTrade),
      fmtMoney(worstTrade),
      `${buyTrades.length}`,
      `${sellTrades.length}`
    ];
    const statColW = pageW / 6;
    for (let i = 0; i < 6; i++) {
      const x = leftMargin + statColW * i + 5;
      doc.fill("#888888").fontSize(7).font("Helvetica").text(statLabels[i], x, y + 8, { width: statColW - 10 });
      doc.fill("#ffffff").fontSize(11).font("Helvetica-Bold").text(statValues[i], x, y + 22, { width: statColW - 10 });
    }
    y += 65;

    // ═══════════════════════════════════════════
    // PNL POR ESTRATEGIA
    // ═══════════════════════════════════════════
    doc.fill("#00ff88").fontSize(14).font("Helvetica-Bold").text("PNL POR ESTRATEGIA", leftMargin, y);
    y += 22;

    // Table header
    const stratHeaders = ["Estrategia", "Trades", "Ganados", "Win Rate", "PnL"];
    const stratColWidths = [pageW * 0.3, pageW * 0.15, pageW * 0.15, pageW * 0.2, pageW * 0.2];
    doc.rect(leftMargin, y, pageW, 18).fill("#1a1a1a");
    let sx = leftMargin;
    for (let i = 0; i < stratHeaders.length; i++) {
      doc.fill("#888888").fontSize(8).font("Helvetica-Bold").text(stratHeaders[i], sx + 5, y + 4, { width: stratColWidths[i] - 10 });
      sx += stratColWidths[i];
    }
    y += 18;

    const stratEntries = Object.entries(pnlByStrategy).sort((a, b) => b[1].pnl - a[1].pnl);
    for (const [name, data] of stratEntries) {
      if (y > 750) { doc.addPage(); y = 40; }
      sx = leftMargin;
      const wr = data.trades > 0 ? (data.wins / data.trades * 100).toFixed(1) + "%" : "-";
      const rowData = [name.toUpperCase(), `${data.trades}`, `${data.wins}`, wr, fmtMoney(data.pnl)];
      for (let i = 0; i < rowData.length; i++) {
        const color = i === 4 ? (data.pnl >= 0 ? "#00ff88" : "#ff4444") : "#ffffff";
        doc.fill(color).fontSize(9).font("Helvetica").text(rowData[i], sx + 5, y + 3, { width: stratColWidths[i] - 10 });
        sx += stratColWidths[i];
      }
      y += 16;
    }
    if (stratEntries.length === 0) {
      doc.fill("#666666").fontSize(9).font("Helvetica").text("Sin trades cerrados en este dia", leftMargin + 5, y + 3);
      y += 16;
    }
    y += 15;

    // ═══════════════════════════════════════════
    // PNL POR MONEDA
    // ═══════════════════════════════════════════
    if (y > 680) { doc.addPage(); y = 40; }
    doc.fill("#00ff88").fontSize(14).font("Helvetica-Bold").text("PNL POR MONEDA", leftMargin, y);
    y += 22;

    doc.rect(leftMargin, y, pageW, 18).fill("#1a1a1a");
    const coinHeaders = ["Moneda", "Trades", "Ganados", "Win Rate", "PnL"];
    sx = leftMargin;
    for (let i = 0; i < coinHeaders.length; i++) {
      doc.fill("#888888").fontSize(8).font("Helvetica-Bold").text(coinHeaders[i], sx + 5, y + 4, { width: stratColWidths[i] - 10 });
      sx += stratColWidths[i];
    }
    y += 18;

    const coinEntries = Object.entries(pnlByCoin).sort((a, b) => b[1].pnl - a[1].pnl);
    for (const [symbol, data] of coinEntries) {
      if (y > 750) { doc.addPage(); y = 40; }
      sx = leftMargin;
      const wr = data.trades > 0 ? (data.wins / data.trades * 100).toFixed(1) + "%" : "-";
      const rowData = [symbol, `${data.trades}`, `${data.wins}`, wr, fmtMoney(data.pnl)];
      for (let i = 0; i < rowData.length; i++) {
        const color = i === 4 ? (data.pnl >= 0 ? "#00ff88" : "#ff4444") : "#ffffff";
        doc.fill(color).fontSize(9).font("Helvetica").text(rowData[i], sx + 5, y + 3, { width: stratColWidths[i] - 10 });
        sx += stratColWidths[i];
      }
      y += 16;
    }
    if (coinEntries.length === 0) {
      doc.fill("#666666").fontSize(9).font("Helvetica").text("Sin trades cerrados en este dia", leftMargin + 5, y + 3);
      y += 16;
    }
    y += 15;

    // ═══════════════════════════════════════════
    // EVOLUCIÓN DE CAPITAL (últimos 14 días)
    // ═══════════════════════════════════════════
    if (y > 580) { doc.addPage(); y = 40; }
    doc.fill("#00ff88").fontSize(14).font("Helvetica-Bold").text("EVOLUCION DE CAPITAL (ultimos 14 dias)", leftMargin, y);
    y += 22;

    if (pnlHistoryData.length > 1) {
      const chartH = 100;
      const chartW = pageW;
      const balances = pnlHistoryData.map(p => parseFloat(p.balance));
      const minBal = Math.min(...balances) * 0.995;
      const maxBal = Math.max(...balances) * 1.005;
      const range = maxBal - minBal || 1;

      // Draw chart background
      doc.rect(leftMargin, y, chartW, chartH).lineWidth(0.5).stroke("#333333");

      // Draw grid lines
      for (let i = 0; i <= 4; i++) {
        const gy = y + chartH - (chartH * i / 4);
        doc.moveTo(leftMargin, gy).lineTo(leftMargin + chartW, gy).lineWidth(0.3).stroke("#222222");
        const val = minBal + range * i / 4;
        doc.fill("#666666").fontSize(6).font("Helvetica").text(`$${val.toFixed(0)}`, leftMargin + 2, gy - 8);
      }

      // Draw line chart
      const stepX = chartW / (pnlHistoryData.length - 1);
      doc.strokeColor("#00ff88").lineWidth(1.5);
      for (let i = 0; i < pnlHistoryData.length; i++) {
        const px = leftMargin + stepX * i;
        const py = y + chartH - ((balances[i] - minBal) / range * chartH);
        if (i === 0) doc.moveTo(px, py);
        else doc.lineTo(px, py);
      }
      doc.stroke();

      // Draw dots and date labels
      for (let i = 0; i < pnlHistoryData.length; i++) {
        const px = leftMargin + stepX * i;
        const py = y + chartH - ((balances[i] - minBal) / range * chartH);
        doc.circle(px, py, 2).fill("#00ff88");
        if (i % 2 === 0 || i === pnlHistoryData.length - 1) {
          const dateLabel = pnlHistoryData[i].date.slice(5); // MM-DD
          doc.fill("#666666").fontSize(5).font("Helvetica").text(dateLabel, px - 10, y + chartH + 3, { width: 30, align: "center" });
        }
      }
      y += chartH + 25;
    } else {
      doc.fill("#666666").fontSize(9).font("Helvetica").text("Datos insuficientes para grafico (necesita al menos 2 dias)", leftMargin + 5, y + 3);
      y += 20;
    }
    y += 10;

    // ═══════════════════════════════════════════
    // POSICIONES ABIERTAS
    // ═══════════════════════════════════════════
    if (y > 620) { doc.addPage(); y = 40; }
    doc.fill("#00ff88").fontSize(14).font("Helvetica-Bold").text("POSICIONES ABIERTAS", leftMargin, y);
    y += 22;

    if (positions.length > 0) {
      const posHeaders = ["Par", "Estrategia", "Exchange", "Precio Entrada", "Cantidad", "Monto"];
      const posColW = [pageW * 0.18, pageW * 0.15, pageW * 0.15, pageW * 0.2, pageW * 0.17, pageW * 0.15];
      doc.rect(leftMargin, y, pageW, 18).fill("#1a1a1a");
      sx = leftMargin;
      for (let i = 0; i < posHeaders.length; i++) {
        doc.fill("#888888").fontSize(8).font("Helvetica-Bold").text(posHeaders[i], sx + 5, y + 4, { width: posColW[i] - 10 });
        sx += posColW[i];
      }
      y += 18;

      for (const pos of positions) {
        if (y > 750) { doc.addPage(); y = 40; }
        sx = leftMargin;
        const rowData = [
          pos.symbol,
          pos.strategyType,
          pos.exchange,
          `$${parseFloat(pos.buyPrice).toFixed(4)}`,
          parseFloat(pos.qty).toFixed(6),
          `$${parseFloat(pos.tradeAmount ?? "0").toFixed(2)}`
        ];
        for (let i = 0; i < rowData.length; i++) {
          doc.fill("#ffffff").fontSize(8).font("Helvetica").text(rowData[i], sx + 5, y + 3, { width: posColW[i] - 10 });
          sx += posColW[i];
        }
        y += 14;
      }
    } else {
      doc.fill("#666666").fontSize(9).font("Helvetica").text("Sin posiciones abiertas", leftMargin + 5, y + 3);
      y += 16;
    }
    y += 15;

    // ═══════════════════════════════════════════
    // DETALLE DE TRADES
    // ═══════════════════════════════════════════
    if (y > 600) { doc.addPage(); y = 40; }
    doc.fill("#00ff88").fontSize(14).font("Helvetica-Bold").text(`DETALLE DE TRADES (${allTrades.length} ops)`, leftMargin, y);
    y += 22;

    if (allTrades.length > 0) {
      const tradeHeaders = ["Hora", "Par", "Lado", "Estrategia", "Precio", "Cantidad", "PnL"];
      const tradeColW = [pageW * 0.14, pageW * 0.13, pageW * 0.09, pageW * 0.13, pageW * 0.17, pageW * 0.17, pageW * 0.17];
      doc.rect(leftMargin, y, pageW, 18).fill("#1a1a1a");
      sx = leftMargin;
      for (let i = 0; i < tradeHeaders.length; i++) {
        doc.fill("#888888").fontSize(7).font("Helvetica-Bold").text(tradeHeaders[i], sx + 3, y + 4, { width: tradeColW[i] - 6 });
        sx += tradeColW[i];
      }
      y += 18;

      for (const t of allTrades) {
        if (y > 750) { doc.addPage(); y = 40; }
        sx = leftMargin;
        const pnlVal = parseFloat(t.pnl ?? "0");
        const time = t.createdAt ? new Date(t.createdAt).toISOString().slice(11, 19) : "-";
        const sideLabel = t.side === "buy" ? "COMPRA" : "VENTA";
        const rowData = [
          time,
          t.symbol,
          sideLabel,
          (t.strategy ?? "-").toUpperCase(),
          `$${parseFloat(t.price).toFixed(4)}`,
          parseFloat(t.qty).toFixed(6),
          t.side === "sell" ? fmtMoney(pnlVal) : "-"
        ];
        // Alternate row bg
        if (allTrades.indexOf(t) % 2 === 0) {
          doc.rect(leftMargin, y, pageW, 13).fill("#0d0d0d");
        }
        for (let i = 0; i < rowData.length; i++) {
          let color = "#ffffff";
          if (i === 2) color = t.side === "buy" ? "#00aaff" : "#ffaa00";
          if (i === 6 && t.side === "sell") color = pnlVal >= 0 ? "#00ff88" : "#ff4444";
          doc.fill(color).fontSize(7).font("Helvetica").text(rowData[i], sx + 3, y + 3, { width: tradeColW[i] - 6 });
          sx += tradeColW[i];
        }
        y += 13;
      }
    } else {
      doc.fill("#666666").fontSize(9).font("Helvetica").text("Sin trades en este dia", leftMargin + 5, y + 3);
      y += 16;
    }

    // ═══════════════════════════════════════════
    // ESTRATEGIAS ACTIVAS
    // ═══════════════════════════════════════════
    if (y > 620) { doc.addPage(); y = 40; }
    y += 15;
    doc.fill("#00ff88").fontSize(14).font("Helvetica-Bold").text("ESTRATEGIAS CONFIGURADAS", leftMargin, y);
    y += 22;

    if (userStrategies.length > 0) {
      const sHeaders = ["Par", "Tipo", "Mercado", "Asignacion", "PnL Total", "Trades", "Estado"];
      const sColW = [pageW * 0.15, pageW * 0.12, pageW * 0.12, pageW * 0.13, pageW * 0.17, pageW * 0.13, pageW * 0.18];
      doc.rect(leftMargin, y, pageW, 18).fill("#1a1a1a");
      sx = leftMargin;
      for (let i = 0; i < sHeaders.length; i++) {
        doc.fill("#888888").fontSize(7).font("Helvetica-Bold").text(sHeaders[i], sx + 3, y + 4, { width: sColW[i] - 6 });
        sx += sColW[i];
      }
      y += 18;

      for (const s of userStrategies) {
        if (y > 750) { doc.addPage(); y = 40; }
        sx = leftMargin;
        const sPnl = parseFloat(s.pnl ?? "0");
        const rowData = [
          s.symbol,
          s.strategyType.toUpperCase(),
          s.market.toUpperCase(),
          `${s.allocationPct}%`,
          fmtMoney(sPnl),
          `${s.trades ?? 0}`,
          s.enabled ? "ACTIVA" : "INACTIVA"
        ];
        for (let i = 0; i < rowData.length; i++) {
          let color = "#ffffff";
          if (i === 4) color = sPnl >= 0 ? "#00ff88" : "#ff4444";
          if (i === 6) color = s.enabled ? "#00ff88" : "#ff4444";
          doc.fill(color).fontSize(7).font("Helvetica").text(rowData[i], sx + 3, y + 3, { width: sColW[i] - 6 });
          sx += sColW[i];
        }
        y += 13;
      }
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fill("#444444").fontSize(7).font("Helvetica")
        .text(`PHANTOM Trading Intelligence - Reporte Diario - Pagina ${i + 1}/${pageCount}`, leftMargin, doc.page.height - 30, { width: pageW, align: "center" });
    }

    doc.end();
  });
}

// ─── Express Route Registration ───
export function registerReportRoutes(app: Express) {
  // Cookie parser middleware (simple)
  app.use((req: Request, _res: Response, next: Function) => {
    if (!req.cookies) {
      const cookieHeader = req.headers.cookie ?? "";
      req.cookies = Object.fromEntries(
        cookieHeader.split(";").map(c => {
          const [k, ...v] = c.trim().split("=");
          return [k, v.join("=")];
        }).filter(([k]) => k)
      );
    }
    next();
  });

  app.get("/api/report/daily", async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) {
        res.status(401).json({ error: "No autenticado. Inicia sesión primero." });
        return;
      }

      // Date parameter: default to today
      const dateStr = (req.query.date as string) ?? new Date().toISOString().slice(0, 10);
      
      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        res.status(400).json({ error: "Formato de fecha inválido. Usa YYYY-MM-DD" });
        return;
      }

      const pdfBuffer = await generateDailyReportPDF(userId, dateStr);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="PHANTOM_Reporte_${dateStr}.pdf"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("[Report] Error generating PDF:", error instanceof Error ? error.stack : error);
      res.status(500).json({ error: "Error generando el reporte" });
    }
  });

  // Also support a range report
  app.get("/api/report/summary", async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) {
        res.status(401).json({ error: "No autenticado" });
        return;
      }

      // Default to today
      const dateStr = (req.query.date as string) ?? new Date().toISOString().slice(0, 10);
      const pdfBuffer = await generateDailyReportPDF(userId, dateStr);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="PHANTOM_Resumen_${dateStr}.pdf"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("[Report] Error:", error);
      res.status(500).json({ error: "Error generando el resumen" });
    }
  });

  console.log("[Report] PDF report routes registered: GET /api/report/daily?date=YYYY-MM-DD");
}
