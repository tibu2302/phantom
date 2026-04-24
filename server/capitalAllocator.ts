/**
 * PHANTOM AI Capital Allocator v8.2
 * 
 * Analyzes historical performance of each strategy+pair combination
 * and dynamically reallocates capital to maximize returns.
 * 
 * Key features:
 * - Performance scoring per strategy+pair (PnL, win rate, profit factor, Sharpe)
 * - Dynamic allocation: more capital to top performers
 * - Scalping XAU boost: aggressive allocation when XAU scalping is top performer
 * - Auto-reinvestment: compound gains into best strategies
 * - Nocturnal mode: lower thresholds during low-volume hours for predictable moves
 * - Safety limits: no single strategy+pair can exceed 40% of total capital
 */

import * as db from "./db";

// ─── Types ───
export interface StrategyPerformance {
  strategy: string;
  symbol: string;
  totalPnl: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  sharpeRatio: number;
  score: number; // composite AI score 0-100
  currentAllocation: number;
  suggestedAllocation: number;
}

export interface AllocationDecision {
  strategy: string;
  symbol: string;
  oldAllocationPct: number;
  newAllocationPct: number;
  reason: string;
}

export interface AllocatorState {
  lastRunAt: number;
  decisions: AllocationDecision[];
  topPerformer: { strategy: string; symbol: string; score: number } | null;
  totalReallocated: number;
}

// ─── Constants ───
const MAX_ALLOCATION_PCT = 40; // No single strategy+pair can exceed 40%
const MIN_ALLOCATION_PCT = 5;  // Minimum allocation to keep diversity
const REBALANCE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MIN_TRADES_FOR_SCORING = 5; // Need at least 5 trades to score
const REINVEST_THRESHOLD = 50; // Reinvest when accumulated gains > $50
const MAX_REINVEST_MULTIPLIER = 1.5; // Never exceed 150% of initial capital

// ─── Volatile Scalping Pairs ───
export const VOLATILE_SCALPING_PAIRS = [
  { symbol: "PEPEUSDT", market: "crypto", category: "spot", minVolatility: 2.0 },
  { symbol: "WIFUSDT", market: "crypto", category: "spot", minVolatility: 2.5 },
  { symbol: "BONKUSDT", market: "crypto", category: "spot", minVolatility: 2.0 },
  { symbol: "SHIBUSDT", market: "crypto", category: "spot", minVolatility: 1.5 },
  { symbol: "FLOKIUSDT", market: "crypto", category: "spot", minVolatility: 2.0 },
];

// ─── Nocturnal Mode ───
// 2am-6am UTC: less volume but more predictable moves
export function isNocturnalHours(): boolean {
  const utcHour = new Date().getUTCHours();
  return utcHour >= 2 && utcHour < 6;
}

export function getNocturnalMultiplier(): { confidenceReduction: number; sizeMultiplier: number } {
  if (!isNocturnalHours()) return { confidenceReduction: 0, sizeMultiplier: 1.0 };
  // During nocturnal hours: lower confidence threshold by 25%, but reduce size by 30%
  return { confidenceReduction: 0.25, sizeMultiplier: 0.7 };
}

// ─── Performance Analysis ───
export async function analyzeStrategyPerformance(userId: number): Promise<StrategyPerformance[]> {
  const allTrades = await db.getUserTrades(userId, 10000);
  const strategies = await db.getUserStrategies(userId);
  
  // Group trades by strategy+symbol
  const groups: Record<string, typeof allTrades> = {};
  for (const trade of allTrades) {
    if (trade.side === "buy") continue; // Only count sell trades for PnL
    const key = `${trade.strategy}:${trade.symbol}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(trade);
  }
  
  const performances: StrategyPerformance[] = [];
  
  for (const [key, trades] of Object.entries(groups)) {
    const [strategy, symbol] = key.split(":");
    if (trades.length < 2) continue; // Need at least 2 trades
    
    const pnls = trades.map(t => parseFloat(t.pnl ?? "0"));
    const totalPnl = pnls.reduce((s, p) => s + p, 0);
    const wins = pnls.filter(p => p > 0);
    const losses = pnls.filter(p => p < 0);
    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, p) => s + p, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, p) => s + p, 0) / losses.length) : 0;
    const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : avgWin > 0 ? 10 : 0;
    
    // Sharpe ratio approximation (annualized)
    const mean = totalPnl / trades.length;
    const variance = pnls.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / Math.max(1, trades.length - 1);
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(365) : 0;
    
    // Composite AI score (0-100)
    // Weights: PnL (30%), Win Rate (25%), Profit Factor (20%), Sharpe (15%), Trade Count (10%)
    const pnlScore = Math.min(30, Math.max(0, (totalPnl / 10) * 3)); // $10 = 3 points, max 30
    const wrScore = Math.min(25, (winRate / 100) * 25);
    const pfScore = Math.min(20, Math.max(0, profitFactor * 5));
    const shScore = Math.min(15, Math.max(0, sharpeRatio * 3));
    const tcScore = Math.min(10, (trades.length / 50) * 10);
    const score = Math.round(pnlScore + wrScore + pfScore + shScore + tcScore);
    
    // Find current allocation
    const strat = strategies.find(s => s.symbol === symbol && s.strategyType === strategy);
    const currentAllocation = strat?.allocationPct ?? 15;
    
    performances.push({
      strategy, symbol, totalPnl, tradeCount: trades.length,
      winCount: wins.length, lossCount: losses.length,
      winRate, profitFactor, avgWin, avgLoss, sharpeRatio,
      score, currentAllocation, suggestedAllocation: currentAllocation,
    });
  }
  
  // Sort by score descending
  performances.sort((a, b) => b.score - a.score);
  
  // Calculate suggested allocations based on score
  const totalScore = performances.reduce((s, p) => s + p.score, 0);
  if (totalScore > 0) {
    for (const perf of performances) {
      const rawAlloc = (perf.score / totalScore) * 100;
      // Clamp between min and max
      perf.suggestedAllocation = Math.round(
        Math.max(MIN_ALLOCATION_PCT, Math.min(MAX_ALLOCATION_PCT, rawAlloc))
      );
    }
  }
  
  return performances;
}

// ─── Rebalance Capital ───
export async function rebalanceCapital(userId: number): Promise<AllocatorState> {
  const performances = await analyzeStrategyPerformance(userId);
  const strategies = await db.getUserStrategies(userId);
  const decisions: AllocationDecision[] = [];
  
  if (performances.length === 0) {
    return { lastRunAt: Date.now(), decisions: [], topPerformer: null, totalReallocated: 0 };
  }
  
  const topPerformer = performances[0];
  let totalReallocated = 0;
  
  for (const perf of performances) {
    if (perf.tradeCount < MIN_TRADES_FOR_SCORING) continue;
    
    const diff = perf.suggestedAllocation - perf.currentAllocation;
    // Only rebalance if difference is significant (> 3%)
    if (Math.abs(diff) < 3) continue;
    
    // Find the strategy in DB and update
    const strat = strategies.find(s => s.symbol === perf.symbol && s.strategyType === perf.strategy);
    if (!strat) continue;
    
    try {
      await db.upsertStrategy(userId, {
        symbol: perf.symbol,
        strategyType: perf.strategy,
        allocationPct: perf.suggestedAllocation,
      });
      
      decisions.push({
        strategy: perf.strategy,
        symbol: perf.symbol,
        oldAllocationPct: perf.currentAllocation,
        newAllocationPct: perf.suggestedAllocation,
        reason: diff > 0
          ? `Top performer (score=${perf.score}, PnL=$${perf.totalPnl.toFixed(2)}, WR=${perf.winRate.toFixed(0)}%)`
          : `Underperformer (score=${perf.score}, PnL=$${perf.totalPnl.toFixed(2)}, WR=${perf.winRate.toFixed(0)}%)`,
      });
      
      totalReallocated += Math.abs(diff);
    } catch { /* silent */ }
  }
  
  return {
    lastRunAt: Date.now(),
    decisions,
    topPerformer: { strategy: topPerformer.strategy, symbol: topPerformer.symbol, score: topPerformer.score },
    totalReallocated,
  };
}

// ─── Auto-Reinvestment ───
export async function checkAutoReinvest(userId: number, minAmount: number = REINVEST_THRESHOLD): Promise<{
  reinvested: boolean;
  amount: number;
  target: string;
  newBalance: string;
} | null> {
  const state = await db.getOrCreateBotState(userId);
  if (!state) return null;
  
  const currentBalance = parseFloat(state.currentBalance ?? "5000");
  const initialBalance = parseFloat(state.initialBalance ?? "5000");
  const accumulatedGains = currentBalance - initialBalance;
  
  // Only reinvest if gains exceed threshold
  if (accumulatedGains < minAmount) return null;
  
  // Don't exceed max reinvest multiplier
  if (currentBalance >= initialBalance * MAX_REINVEST_MULTIPLIER) return null;
  
  // Find the best performing strategy+pair
  const performances = await analyzeStrategyPerformance(userId);
  if (performances.length === 0) return null;
  
  const best = performances[0];
  if (best.score < 20) return null; // Don't reinvest if nothing is performing well
  
  // Reinvest 50% of accumulated gains into the best performer
  const reinvestAmount = accumulatedGains * 0.5;
  const newAllocation = Math.min(MAX_ALLOCATION_PCT, best.currentAllocation + 5);
  
  try {
    await db.upsertStrategy(userId, {
      symbol: best.symbol,
      strategyType: best.strategy,
      allocationPct: newAllocation,
    });
    
    // Update initial balance to reflect reinvestment (so it doesn't trigger again)
    await db.updateBotState(userId, {
      initialBalance: (initialBalance + reinvestAmount).toFixed(2),
    });
    
    return {
      reinvested: true,
      amount: reinvestAmount,
      target: `${best.strategy} ${best.symbol}`,
      newBalance: (initialBalance + reinvestAmount).toFixed(2),
    };
  } catch {
    return null;
  }
}

// ─── Dynamic Trailing Stop for Scalping ───
export function calculateDynamicTrailingStop(
  buyPrice: number,
  currentPrice: number,
  highestPrice: number,
  atrPct: number,
  regime: string,
): { shouldSell: boolean; newHighest: number; trailingPct: number; reason: string } {
  const newHighest = Math.max(highestPrice, currentPrice);
  const profitPct = (currentPrice - buyPrice) / buyPrice;
  
  // Dynamic trailing based on ATR and regime
  let trailingPct: number;
  if (regime === "strong_trend_up") {
    // In strong uptrend: wider trailing (let profits run)
    trailingPct = Math.max(0.008, atrPct * 0.02); // 0.8% min, 2x ATR
  } else if (regime === "trend_up") {
    trailingPct = Math.max(0.006, atrPct * 0.015); // 0.6% min, 1.5x ATR
  } else if (regime === "ranging") {
    // In ranging: tighter trailing (take profits quickly)
    trailingPct = Math.max(0.004, atrPct * 0.01); // 0.4% min, 1x ATR
  } else {
    // Volatile/bearish: very tight trailing
    trailingPct = Math.max(0.003, atrPct * 0.008); // 0.3% min
  }
  
  // Activation: only activate trailing after 0.3% profit
  const activationPct = 0.003;
  if (profitPct < activationPct) {
    return { shouldSell: false, newHighest, trailingPct, reason: "waiting for activation" };
  }
  
  // Check if price dropped from highest by trailing %
  if (newHighest > buyPrice * (1 + activationPct)) {
    const dropFromHigh = (newHighest - currentPrice) / newHighest;
    if (dropFromHigh >= trailingPct) {
      return {
        shouldSell: true,
        newHighest,
        trailingPct,
        reason: `TRAILING-STOP: drop ${(dropFromHigh * 100).toFixed(2)}% from high $${newHighest.toFixed(4)} (threshold ${(trailingPct * 100).toFixed(2)}%)`,
      };
    }
  }
  
  // Profit lock: if profit > 1.5%, use tighter trailing (0.2%)
  if (profitPct > 0.015) {
    const tightTrail = 0.002;
    const dropFromHigh = (newHighest - currentPrice) / newHighest;
    if (dropFromHigh >= tightTrail) {
      return {
        shouldSell: true,
        newHighest,
        trailingPct: tightTrail,
        reason: `PROFIT-LOCK: ${(profitPct * 100).toFixed(2)}% profit, drop ${(dropFromHigh * 100).toFixed(2)}% from high`,
      };
    }
  }
  
  return { shouldSell: false, newHighest, trailingPct, reason: "trailing active, holding" };
}

// ─── Scalping XAU Boost ───
// When XAU is the top performer, allow more aggressive scalping
export function getXAUBoostMultiplier(performances: StrategyPerformance[]): number {
  const xauScalp = performances.find(p => p.symbol === "XAUUSDT" && p.strategy === "scalping");
  if (!xauScalp) return 1.0;
  
  // If XAU scalping is top 3 performer with score > 40
  const rank = performances.findIndex(p => p.symbol === "XAUUSDT" && p.strategy === "scalping");
  if (rank <= 2 && xauScalp.score > 40) {
    // Boost: 1.5x to 2.5x based on score
    return 1.5 + (xauScalp.score / 100);
  }
  return 1.0;
}

// ─── Grid Trending Adjustment ───
export function getTrendingGridAdjustment(regime: string): {
  spreadMultiplier: number;
  levelsMultiplier: number;
} {
  switch (regime) {
    case "strong_trend_up":
    case "strong_trend_down":
      // In strong trend: tighter spread (50%), more levels (1.5x) = more cycles
      return { spreadMultiplier: 0.5, levelsMultiplier: 1.5 };
    case "trend_up":
    case "trend_down":
      // In mild trend: slightly tighter spread (70%), more levels (1.2x)
      return { spreadMultiplier: 0.7, levelsMultiplier: 1.2 };
    case "ranging":
      // In ranging: normal spread, normal levels
      return { spreadMultiplier: 1.0, levelsMultiplier: 1.0 };
    case "volatile":
      // In volatile: wider spread (1.3x), fewer levels (0.8x)
      return { spreadMultiplier: 1.3, levelsMultiplier: 0.8 };
    default:
      return { spreadMultiplier: 1.0, levelsMultiplier: 1.0 };
  }
}

// ─── Opportunity Alert Builder ───
export function buildOpportunityAlert(
  symbol: string,
  score: number,
  direction: string,
  regime: string,
  atrPct: number,
  estimatedTP: number,
  strategy: string,
): string {
  const dirEmoji = direction === "buy" ? "🟢" : "🔴";
  const scoreEmoji = score >= 80 ? "🔥" : score >= 60 ? "⚡" : "📊";
  
  return `${scoreEmoji} <b>PHANTOM — Oportunidad Detectada</b>\n\n` +
    `Par: <b>${symbol}</b>\n` +
    `${dirEmoji} Dirección: <b>${direction.toUpperCase()}</b>\n` +
    `📊 Score: <b>${score}/100</b>\n` +
    `🌊 Régimen: ${regime}\n` +
    `📈 Volatilidad (ATR): ${atrPct.toFixed(2)}%\n` +
    `🎯 TP Estimado: ${estimatedTP.toFixed(2)}%\n` +
    `⚙️ Estrategia: ${strategy}\n\n` +
    `<i>El bot entrará automáticamente si las condiciones se mantienen.</i>`;
}

// ─── Stats Report Builder (for /stats command) ───
export async function buildStatsReport(userId: number): Promise<string> {
  const allTrades = await db.getUserTrades(userId, 10000);
  const state = await db.getOrCreateBotState(userId);
  const performances = await analyzeStrategyPerformance(userId);
  
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  
  const todayTrades = allTrades.filter(t => new Date(t.createdAt) >= todayStart && t.side === "sell");
  const weekTrades = allTrades.filter(t => new Date(t.createdAt) >= weekStart && t.side === "sell");
  const monthTrades = allTrades.filter(t => new Date(t.createdAt) >= monthStart && t.side === "sell");
  
  const todayPnl = todayTrades.reduce((s, t) => s + parseFloat(t.pnl ?? "0"), 0);
  const weekPnl = weekTrades.reduce((s, t) => s + parseFloat(t.pnl ?? "0"), 0);
  const monthPnl = monthTrades.reduce((s, t) => s + parseFloat(t.pnl ?? "0"), 0);
  
  const todayWins = todayTrades.filter(t => parseFloat(t.pnl ?? "0") > 0).length;
  const todayWR = todayTrades.length > 0 ? ((todayWins / todayTrades.length) * 100).toFixed(0) : "0";
  
  const bestTrade = allTrades.reduce((best, t) => {
    const pnl = parseFloat(t.pnl ?? "0");
    return pnl > (best?.pnl ?? 0) ? { symbol: t.symbol, pnl, strategy: t.strategy } : best;
  }, { symbol: "", pnl: 0, strategy: "" } as { symbol: string; pnl: number; strategy: string });
  
  const worstTrade = allTrades.reduce((worst, t) => {
    const pnl = parseFloat(t.pnl ?? "0");
    return pnl < (worst?.pnl ?? 0) ? { symbol: t.symbol, pnl, strategy: t.strategy } : worst;
  }, { symbol: "", pnl: 0, strategy: "" } as { symbol: string; pnl: number; strategy: string });
  
  const currentBalance = parseFloat(state?.currentBalance ?? "5000");
  const initialBalance = parseFloat(state?.initialBalance ?? "5000");
  const totalPnl = currentBalance - initialBalance;
  const totalPnlPct = initialBalance > 0 ? ((totalPnl / initialBalance) * 100).toFixed(1) : "0";
  
  // Top 3 performers
  const top3 = performances.slice(0, 3);
  let top3Lines = "";
  for (let i = 0; i < top3.length; i++) {
    const p = top3[i];
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
    top3Lines += `\n  ${medal} ${p.strategy} ${p.symbol}: $${p.totalPnl.toFixed(2)} (WR ${p.winRate.toFixed(0)}%, ${p.tradeCount} trades)`;
  }
  
  const todayEmoji = todayPnl >= 0 ? "🟢" : "🔴";
  const weekEmoji = weekPnl >= 0 ? "🟢" : "🔴";
  const monthEmoji = monthPnl >= 0 ? "🟢" : "🔴";
  const totalEmoji = totalPnl >= 0 ? "🟢" : "🔴";
  
  return `📊 <b>PHANTOM — Estadísticas Completas</b>\n\n` +
    `💰 <b>Balance</b>: $${currentBalance.toFixed(2)}\n` +
    `${totalEmoji} <b>Ganancia Total</b>: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)} (${totalPnlPct}%)\n\n` +
    `📅 <b>PnL por Período</b>\n` +
    `  ${todayEmoji} Hoy: ${todayPnl >= 0 ? "+" : ""}$${todayPnl.toFixed(2)} (${todayTrades.length} trades, WR ${todayWR}%)\n` +
    `  ${weekEmoji} 7 Días: ${weekPnl >= 0 ? "+" : ""}$${weekPnl.toFixed(2)} (${weekTrades.length} trades)\n` +
    `  ${monthEmoji} Mes: ${monthPnl >= 0 ? "+" : ""}$${monthPnl.toFixed(2)} (${monthTrades.length} trades)\n\n` +
    `🏆 <b>Top 3 Estrategias</b>:${top3Lines}\n\n` +
    `✅ <b>Mejor Trade</b>: ${bestTrade.symbol} (${bestTrade.strategy}) +$${bestTrade.pnl.toFixed(2)}\n` +
    `❌ <b>Peor Trade</b>: ${worstTrade.symbol} (${worstTrade.strategy}) $${worstTrade.pnl.toFixed(2)}\n\n` +
    `—\n<i>PHANTOM Trading Bot • /stats</i>`;
}
