/**
 * PHANTOM Auto-Optimizer Engine v8.0
 * 
 * Self-optimizing modules:
 * 16. Auto-Tuning — automatically adjust parameters based on recent performance
 * 17. Market Microstructure — tick-by-tick analysis for micro-timing
 * 18. Portfolio Optimization (Markowitz) — optimal allocation across assets
 * 19. Adaptive Learning Rate — dynamic aggressiveness based on win streaks
 * 20. Performance Analytics — track and report all metrics
 */

// ═══════════════════════════════════════════════════════════════
// 16. AUTO-TUNING
// ═══════════════════════════════════════════════════════════════

export interface TuningParams {
  gridSpreadMultiplier: number;     // 0.5 - 2.0
  scalpingConfidenceMin: number;    // 20 - 60
  futuresConfidenceMin: number;     // 25 - 70
  gridConfidenceMin: number;        // 15 - 50
  maxPositionsGrid: number;         // 2 - 8
  maxPositionsFutures: number;      // 1 - 6
  trailingStopMultiplier: number;   // 0.5 - 2.0
  positionSizeMultiplier: number;   // 0.5 - 2.0
}

interface StrategyPerformance {
  wins: number;
  losses: number;
  totalPnl: number;
  avgWinPercent: number;
  avgLossPercent: number;
  lastUpdated: number;
  recentTrades: { pnl: number; timestamp: number; strategy: string }[];
}

const performanceHistory: Map<string, StrategyPerformance> = new Map();
let currentTuning: TuningParams = getDefaultTuning();

function getDefaultTuning(): TuningParams {
  return {
    gridSpreadMultiplier: 1.0,
    scalpingConfidenceMin: 30,
    futuresConfidenceMin: 35,
    gridConfidenceMin: 20,
    maxPositionsGrid: 5,
    maxPositionsFutures: 5,
    trailingStopMultiplier: 1.0,
    positionSizeMultiplier: 1.0
  };
}

export function recordTradeForTuning(strategy: string, pnl: number, pnlPercent: number): void {
  const key = strategy;
  const perf = performanceHistory.get(key) || {
    wins: 0, losses: 0, totalPnl: 0, avgWinPercent: 0, avgLossPercent: 0,
    lastUpdated: Date.now(), recentTrades: []
  };

  if (pnl > 0) {
    perf.wins++;
    perf.avgWinPercent = (perf.avgWinPercent * (perf.wins - 1) + pnlPercent) / perf.wins;
  } else {
    perf.losses++;
    perf.avgLossPercent = (perf.avgLossPercent * (perf.losses - 1) + Math.abs(pnlPercent)) / Math.max(1, perf.losses);
  }

  perf.totalPnl += pnl;
  perf.lastUpdated = Date.now();
  perf.recentTrades.push({ pnl, timestamp: Date.now(), strategy });
  if (perf.recentTrades.length > 200) perf.recentTrades.shift();

  performanceHistory.set(key, perf);
}

/**
 * Auto-tune parameters based on recent performance
 * Called every ~30 minutes
 */
export function autoTuneParameters(): TuningParams {
  const tuning = getDefaultTuning();

  // Analyze last 24h performance per strategy
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  for (const [strategy, perf] of Array.from(performanceHistory)) {
    const recentTrades = perf.recentTrades.filter(t => now - t.timestamp < day);
    if (recentTrades.length < 5) continue;

    const recentWins = recentTrades.filter(t => t.pnl > 0).length;
    const recentWinRate = recentWins / recentTrades.length;
    const recentPnl = recentTrades.reduce((s, t) => s + t.pnl, 0);

    if (strategy === "grid") {
      if (recentWinRate > 0.7 && recentPnl > 0) {
        // Grid is doing well — be more aggressive
        tuning.gridSpreadMultiplier = 0.85; // Tighter spreads for more trades
        tuning.maxPositionsGrid = 6;
        tuning.gridConfidenceMin = 18; // Lower threshold
      } else if (recentWinRate < 0.5 || recentPnl < 0) {
        // Grid struggling — be more conservative
        tuning.gridSpreadMultiplier = 1.3; // Wider spreads
        tuning.maxPositionsGrid = 3;
        tuning.gridConfidenceMin = 30; // Higher threshold
      }
    }

    if (strategy === "scalping") {
      if (recentWinRate > 0.65 && recentPnl > 0) {
        tuning.scalpingConfidenceMin = 25;
        tuning.positionSizeMultiplier = Math.min(1.5, tuning.positionSizeMultiplier * 1.2);
      } else if (recentWinRate < 0.45) {
        tuning.scalpingConfidenceMin = 40;
        tuning.positionSizeMultiplier = Math.max(0.6, tuning.positionSizeMultiplier * 0.8);
      }
    }

    if (strategy === "futures") {
      if (recentWinRate > 0.6 && recentPnl > 0) {
        tuning.futuresConfidenceMin = 30;
        tuning.maxPositionsFutures = 6;
      } else if (recentWinRate < 0.4 || recentPnl < 0) {
        tuning.futuresConfidenceMin = 50;
        tuning.maxPositionsFutures = 2;
        tuning.trailingStopMultiplier = 0.7; // Tighter trailing
      }
    }
  }

  currentTuning = tuning;
  return tuning;
}

export function getCurrentTuning(): TuningParams {
  return currentTuning;
}

// ═══════════════════════════════════════════════════════════════
// 17. MARKET MICROSTRUCTURE
// ═══════════════════════════════════════════════════════════════

export interface MicrostructureSignal {
  tickDirection: "uptick" | "downtick" | "neutral";
  buyPressure: number;    // 0-100
  sellPressure: number;   // 0-100
  spreadTightness: number; // 0-100 (100 = very tight = liquid)
  direction: "buy" | "sell" | "neutral";
  strength: number;
  reason: string;
}

// Track recent ticks
const tickHistory: Map<string, { price: number; ts: number; side: "buy" | "sell" }[]> = new Map();

export function recordTick(symbol: string, price: number, side: "buy" | "sell"): void {
  const history = tickHistory.get(symbol) || [];
  history.push({ price, ts: Date.now(), side });
  // Keep last 500 ticks
  if (history.length > 500) history.splice(0, history.length - 500);
  tickHistory.set(symbol, history);
}

export function analyzeMicrostructure(
  symbol: string,
  bidPrice: number,
  askPrice: number,
  lastPrice: number
): MicrostructureSignal {
  const ticks = tickHistory.get(symbol) || [];
  const defaultResult: MicrostructureSignal = {
    tickDirection: "neutral", buyPressure: 50, sellPressure: 50,
    spreadTightness: 50, direction: "neutral", strength: 0, reason: "Insufficient data"
  };

  if (ticks.length < 20) return defaultResult;

  // Analyze last 100 ticks
  const recentTicks = ticks.slice(-100);
  const buyTicks = recentTicks.filter(t => t.side === "buy").length;
  const sellTicks = recentTicks.filter(t => t.side === "sell").length;
  const total = recentTicks.length;

  const buyPressure = (buyTicks / total) * 100;
  const sellPressure = (sellTicks / total) * 100;

  // Tick direction (last 10 ticks trend)
  const last10 = ticks.slice(-10);
  const upTicks = last10.filter((t, i) => i > 0 && t.price > last10[i - 1].price).length;
  const downTicks = last10.filter((t, i) => i > 0 && t.price < last10[i - 1].price).length;
  const tickDirection = upTicks > downTicks + 2 ? "uptick" : downTicks > upTicks + 2 ? "downtick" : "neutral";

  // Spread tightness (tighter = more liquid = better for trading)
  const spread = ((askPrice - bidPrice) / lastPrice) * 100;
  const spreadTightness = Math.max(0, Math.min(100, 100 - spread * 1000));

  // Signal
  let direction: "buy" | "sell" | "neutral" = "neutral";
  let strength = 0;
  let reason = "";

  if (buyPressure > 65 && tickDirection === "uptick") {
    direction = "buy";
    strength = Math.min(70, (buyPressure - 50) * 2);
    reason = `Strong buy pressure: ${buyPressure.toFixed(0)}% buys, uptick trend`;
  } else if (sellPressure > 65 && tickDirection === "downtick") {
    direction = "sell";
    strength = Math.min(70, (sellPressure - 50) * 2);
    reason = `Strong sell pressure: ${sellPressure.toFixed(0)}% sells, downtick trend`;
  } else {
    reason = `Balanced: ${buyPressure.toFixed(0)}% buy / ${sellPressure.toFixed(0)}% sell`;
  }

  return { tickDirection, buyPressure, sellPressure, spreadTightness, direction, strength, reason };
}

// ═══════════════════════════════════════════════════════════════
// 18. PORTFOLIO OPTIMIZATION (Markowitz Modern Portfolio Theory)
// ═══════════════════════════════════════════════════════════════

export interface PortfolioAllocation {
  symbol: string;
  weight: number;          // 0-1 (percentage of portfolio)
  expectedReturn: number;  // Daily expected return %
  risk: number;            // Volatility (std dev)
  sharpeRatio: number;     // Risk-adjusted return
}

export interface OptimalPortfolio {
  allocations: PortfolioAllocation[];
  expectedDailyReturn: number;
  portfolioRisk: number;
  sharpeRatio: number;
}

// Track daily returns per symbol
const dailyReturns: Map<string, number[]> = new Map();

export function recordDailyReturn(symbol: string, returnPercent: number): void {
  const returns = dailyReturns.get(symbol) || [];
  returns.push(returnPercent);
  if (returns.length > 60) returns.shift(); // Keep 60 days
  dailyReturns.set(symbol, returns);
}

/**
 * Calculate optimal portfolio allocation using simplified Markowitz
 * Maximizes Sharpe ratio (return per unit of risk)
 */
export function optimizePortfolio(
  symbols: string[],
  totalCapital: number,
  riskFreeRate: number = 0.01 // 1% daily risk-free (staking)
): OptimalPortfolio {
  const allocations: PortfolioAllocation[] = [];

  for (const symbol of symbols) {
    const returns = dailyReturns.get(symbol);
    if (!returns || returns.length < 10) {
      allocations.push({
        symbol,
        weight: 1 / symbols.length, // Equal weight if no data
        expectedReturn: 0,
        risk: 1,
        sharpeRatio: 0
      });
      continue;
    }

    const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length;
    const risk = Math.sqrt(variance);
    const sharpeRatio = risk > 0 ? (avgReturn - riskFreeRate) / risk : 0;

    allocations.push({
      symbol,
      weight: 0, // Will be calculated
      expectedReturn: avgReturn,
      risk,
      sharpeRatio
    });
  }

  // Allocate based on Sharpe ratio (higher Sharpe = more allocation)
  const totalSharpe = allocations.reduce((s, a) => s + Math.max(0, a.sharpeRatio), 0);
  
  if (totalSharpe > 0) {
    for (const alloc of allocations) {
      alloc.weight = Math.max(0.05, Math.max(0, alloc.sharpeRatio) / totalSharpe); // Min 5% per asset
    }
  } else {
    // Equal weight if no positive Sharpe
    const equalWeight = 1 / allocations.length;
    for (const alloc of allocations) alloc.weight = equalWeight;
  }

  // Normalize weights to sum to 1
  const totalWeight = allocations.reduce((s, a) => s + a.weight, 0);
  for (const alloc of allocations) alloc.weight /= totalWeight;

  // Cap at 20% max per asset (diversification rule)
  let excess = 0;
  let underAllocated = 0;
  for (const alloc of allocations) {
    if (alloc.weight > 0.20) {
      excess += alloc.weight - 0.20;
      alloc.weight = 0.20;
    } else {
      underAllocated++;
    }
  }
  if (excess > 0 && underAllocated > 0) {
    const extraPerAsset = excess / underAllocated;
    for (const alloc of allocations) {
      if (alloc.weight < 0.20) alloc.weight += extraPerAsset;
    }
  }

  // Portfolio metrics
  const expectedDailyReturn = allocations.reduce((s, a) => s + a.weight * a.expectedReturn, 0);
  const portfolioRisk = Math.sqrt(allocations.reduce((s, a) => s + (a.weight * a.risk) ** 2, 0));
  const sharpeRatio = portfolioRisk > 0 ? (expectedDailyReturn - riskFreeRate) / portfolioRisk : 0;

  return {
    allocations: allocations.sort((a, b) => b.weight - a.weight),
    expectedDailyReturn,
    portfolioRisk,
    sharpeRatio
  };
}

// ═══════════════════════════════════════════════════════════════
// 19. ADAPTIVE LEARNING RATE
// ═══════════════════════════════════════════════════════════════

export interface AdaptiveState {
  aggressiveness: number;    // 0.3 - 2.0 (multiplier for position sizes)
  winStreak: number;
  lossStreak: number;
  recentWinRate: number;     // Last 20 trades
  mode: "aggressive" | "normal" | "conservative" | "recovery";
  reason: string;
}

const tradeResults: { pnl: number; ts: number }[] = [];
let adaptiveState: AdaptiveState = {
  aggressiveness: 1.0, winStreak: 0, lossStreak: 0,
  recentWinRate: 0.5, mode: "normal", reason: "Initial state"
};

export function recordTradeResult(pnl: number): void {
  tradeResults.push({ pnl, ts: Date.now() });
  if (tradeResults.length > 500) tradeResults.shift();
  updateAdaptiveState();
}

function updateAdaptiveState(): void {
  const recent = tradeResults.slice(-20);
  if (recent.length < 5) return;

  const wins = recent.filter(t => t.pnl > 0).length;
  const recentWinRate = wins / recent.length;

  // Count current streak
  let winStreak = 0, lossStreak = 0;
  for (let i = tradeResults.length - 1; i >= 0; i--) {
    if (tradeResults[i].pnl > 0) {
      if (lossStreak > 0) break;
      winStreak++;
    } else {
      if (winStreak > 0) break;
      lossStreak++;
    }
  }

  let aggressiveness = 1.0;
  let mode: AdaptiveState["mode"] = "normal";
  let reason = "";

  // Winning streak → be more aggressive
  if (winStreak >= 5 && recentWinRate > 0.7) {
    aggressiveness = Math.min(1.8, 1.0 + winStreak * 0.1);
    mode = "aggressive";
    reason = `Win streak ${winStreak} (${(recentWinRate * 100).toFixed(0)}% WR) — increasing size`;
  }
  // Losing streak → be conservative
  else if (lossStreak >= 3) {
    aggressiveness = Math.max(0.4, 1.0 - lossStreak * 0.15);
    mode = "recovery";
    reason = `Loss streak ${lossStreak} — reducing size, recovery mode`;
  }
  // High win rate → slightly more aggressive
  else if (recentWinRate > 0.65) {
    aggressiveness = 1.2;
    mode = "aggressive";
    reason = `Strong WR ${(recentWinRate * 100).toFixed(0)}% — slightly aggressive`;
  }
  // Low win rate → conservative
  else if (recentWinRate < 0.45) {
    aggressiveness = 0.7;
    mode = "conservative";
    reason = `Low WR ${(recentWinRate * 100).toFixed(0)}% — conservative mode`;
  }
  else {
    reason = `Normal mode — WR ${(recentWinRate * 100).toFixed(0)}%`;
  }

  adaptiveState = { aggressiveness, winStreak, lossStreak, recentWinRate, mode, reason };
}

export function getAdaptiveState(): AdaptiveState {
  return adaptiveState;
}

// ═══════════════════════════════════════════════════════════════
// 20. PERFORMANCE ANALYTICS
// ═══════════════════════════════════════════════════════════════

export interface PerformanceReport {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  avgTradeReturn: number;
  bestTrade: number;
  worstTrade: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  byStrategy: Map<string, { trades: number; pnl: number; winRate: number }>;
  dailyReturns: { date: string; pnl: number }[];
}

export function generatePerformanceReport(): PerformanceReport {
  const allTrades = tradeResults;
  const wins = allTrades.filter(t => t.pnl > 0);
  const losses = allTrades.filter(t => t.pnl <= 0);

  const totalPnl = allTrades.reduce((s, t) => s + t.pnl, 0);
  const avgTradeReturn = allTrades.length > 0 ? totalPnl / allTrades.length : 0;
  const bestTrade = allTrades.length > 0 ? Math.max(...allTrades.map(t => t.pnl)) : 0;
  const worstTrade = allTrades.length > 0 ? Math.min(...allTrades.map(t => t.pnl)) : 0;

  // Profit factor
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Max drawdown
  let peak = 0, maxDrawdown = 0, cumPnl = 0;
  for (const trade of allTrades) {
    cumPnl += trade.pnl;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Sharpe ratio (simplified)
  const returns = allTrades.map(t => t.pnl);
  const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const stdDev = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length) : 1;
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

  // By strategy
  const byStrategy = new Map<string, { trades: number; pnl: number; winRate: number }>();
  for (const [strategy, perf] of Array.from(performanceHistory)) {
    const total = perf.wins + perf.losses;
    byStrategy.set(strategy, {
      trades: total,
      pnl: perf.totalPnl,
      winRate: total > 0 ? perf.wins / total : 0
    });
  }

  // Daily returns
  const dailyMap = new Map<string, number>();
  for (const trade of allTrades) {
    const date = new Date(trade.ts).toISOString().split("T")[0];
    dailyMap.set(date, (dailyMap.get(date) || 0) + trade.pnl);
  }
  const dailyReturnsList = Array.from(dailyMap.entries()).map(([date, pnl]) => ({ date, pnl })).sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalTrades: allTrades.length,
    winRate: allTrades.length > 0 ? wins.length / allTrades.length : 0,
    totalPnl,
    avgTradeReturn,
    bestTrade,
    worstTrade,
    sharpeRatio,
    maxDrawdown,
    profitFactor,
    byStrategy,
    dailyReturns: dailyReturnsList
  };
}

// ═══════════════════════════════════════════════════════════════
// AGGREGATE OPTIMIZER SIGNAL
// ═══════════════════════════════════════════════════════════════

export interface OptimizerSignal {
  tuning: TuningParams;
  adaptive: AdaptiveState;
  portfolio: OptimalPortfolio | null;
  overallSizingMultiplier: number;
  shouldTrade: boolean;
  reason: string;
}

export function getOptimizerSignal(
  symbols: string[],
  totalCapital: number
): OptimizerSignal {
  const tuning = getCurrentTuning();
  const adaptive = getAdaptiveState();
  
  let portfolio: OptimalPortfolio | null = null;
  if (dailyReturns.size >= 3) {
    portfolio = optimizePortfolio(symbols, totalCapital);
  }

  // Overall sizing multiplier combines tuning + adaptive
  let overallSizingMultiplier = tuning.positionSizeMultiplier * adaptive.aggressiveness;
  overallSizingMultiplier = Math.max(0.3, Math.min(2.5, overallSizingMultiplier));

  // Should we trade at all?
  let shouldTrade = true;
  let reason = "";

  if (adaptive.mode === "recovery" && adaptive.lossStreak >= 5) {
    shouldTrade = false;
    reason = `Recovery pause: ${adaptive.lossStreak} consecutive losses — waiting for market stabilization`;
  } else {
    reason = `${adaptive.mode} mode (${(adaptive.recentWinRate * 100).toFixed(0)}% WR) — sizing ${overallSizingMultiplier.toFixed(2)}x`;
  }

  return {
    tuning,
    adaptive,
    portfolio,
    overallSizingMultiplier,
    shouldTrade,
    reason
  };
}
