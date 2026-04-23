/**
 * PHANTOM Advanced Strategies Engine v8.0
 * 
 * Intelligent strategy modules:
 * 11. DCA Inteligente — split entries into 3-5 parts with AI timing
 * 12. Pairs Trading — bet on correlation breakdowns
 * 13. Momentum Cascade — enter coins that haven't moved yet when a leader surges
 * 14. Smart Exit with AI — predict optimal exit point
 * 15. News Trading — process news and execute before market reacts
 */

// ═══════════════════════════════════════════════════════════════
// 11. DCA INTELIGENTE (Dollar Cost Averaging with AI)
// ═══════════════════════════════════════════════════════════════

export interface DCAplan {
  totalAmount: number;
  entries: { percent: number; triggerCondition: string; executed: boolean }[];
  currentEntry: number;
  avgEntryPrice: number;
  totalInvested: number;
}

// Active DCA plans per symbol
const dcaPlans: Map<string, DCAplan> = new Map();

/**
 * Create a smart DCA plan: instead of buying all at once,
 * split into entries based on support levels and momentum
 */
export function createDCAPlan(
  symbol: string,
  totalAmount: number,
  currentPrice: number,
  supportLevels: number[],
  signalStrength: number
): DCAplan {
  const entries: DCAplan["entries"] = [];

  if (signalStrength > 70) {
    // Strong signal — 60% now, 25% on first dip, 15% on second dip
    entries.push({ percent: 60, triggerCondition: "immediate", executed: false });
    entries.push({ percent: 25, triggerCondition: "dip_1%", executed: false });
    entries.push({ percent: 15, triggerCondition: "dip_2%", executed: false });
  } else if (signalStrength > 50) {
    // Medium signal — 40% now, 30% on dip, 20% on bigger dip, 10% on support
    entries.push({ percent: 40, triggerCondition: "immediate", executed: false });
    entries.push({ percent: 30, triggerCondition: "dip_1.5%", executed: false });
    entries.push({ percent: 20, triggerCondition: "dip_3%", executed: false });
    entries.push({ percent: 10, triggerCondition: "support_level", executed: false });
  } else {
    // Weak signal — 25% now, spread rest across dips
    entries.push({ percent: 25, triggerCondition: "immediate", executed: false });
    entries.push({ percent: 25, triggerCondition: "dip_1%", executed: false });
    entries.push({ percent: 25, triggerCondition: "dip_2%", executed: false });
    entries.push({ percent: 25, triggerCondition: "dip_3%", executed: false });
  }

  const plan: DCAplan = {
    totalAmount,
    entries,
    currentEntry: 0,
    avgEntryPrice: 0,
    totalInvested: 0
  };

  dcaPlans.set(symbol, plan);
  return plan;
}

/**
 * Check if next DCA entry should execute
 * Returns the amount to buy (0 if no entry needed)
 */
export function checkDCAEntry(
  symbol: string,
  currentPrice: number,
  entryPrice: number
): { shouldBuy: boolean; amount: number; reason: string } {
  const plan = dcaPlans.get(symbol);
  if (!plan) return { shouldBuy: false, amount: 0, reason: "No DCA plan" };

  const nextEntry = plan.entries[plan.currentEntry];
  if (!nextEntry || nextEntry.executed) return { shouldBuy: false, amount: 0, reason: "All entries executed" };

  const dipPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
  let shouldBuy = false;
  let reason = "";

  if (nextEntry.triggerCondition === "immediate") {
    shouldBuy = true;
    reason = `DCA entry ${plan.currentEntry + 1}/${plan.entries.length}: immediate (${nextEntry.percent}%)`;
  } else if (nextEntry.triggerCondition.startsWith("dip_")) {
    const requiredDip = parseFloat(nextEntry.triggerCondition.replace("dip_", "").replace("%", ""));
    if (dipPercent >= requiredDip) {
      shouldBuy = true;
      reason = `DCA entry ${plan.currentEntry + 1}/${plan.entries.length}: dip ${dipPercent.toFixed(1)}% >= ${requiredDip}% (${nextEntry.percent}%)`;
    }
  } else if (nextEntry.triggerCondition === "support_level") {
    // Buy at any support level (simplified)
    if (dipPercent >= 3) {
      shouldBuy = true;
      reason = `DCA entry ${plan.currentEntry + 1}/${plan.entries.length}: near support (${nextEntry.percent}%)`;
    }
  }

  if (shouldBuy) {
    const amount = plan.totalAmount * (nextEntry.percent / 100);
    nextEntry.executed = true;
    plan.totalInvested += amount;
    plan.avgEntryPrice = plan.totalInvested > 0 
      ? (plan.avgEntryPrice * (plan.totalInvested - amount) + currentPrice * amount) / plan.totalInvested
      : currentPrice;
    plan.currentEntry++;
    return { shouldBuy: true, amount, reason };
  }

  return { shouldBuy: false, amount: 0, reason: "Waiting for trigger" };
}

export function clearDCAPlan(symbol: string): void {
  dcaPlans.delete(symbol);
}

// ═══════════════════════════════════════════════════════════════
// 12. PAIRS TRADING
// ═══════════════════════════════════════════════════════════════

export interface PairCorrelation {
  pair: [string, string];
  correlation: number;      // -1 to 1
  currentSpread: number;    // Current price ratio
  avgSpread: number;        // Historical average ratio
  spreadDeviation: number;  // Standard deviations from mean
  signal: "long_a_short_b" | "short_a_long_b" | "neutral";
  strength: number;
}

// Known correlated pairs in crypto
const CORRELATED_PAIRS: [string, string][] = [
  ["BTCUSDT", "ETHUSDT"],
  ["ETHUSDT", "SOLUSDT"],
  ["SOLUSDT", "AVAXUSDT"],
  ["DOGEUSDT", "SHIBUSDT"],
  ["LINKUSDT", "AAVEUSDT"],
  ["XRPUSDT", "ADAUSDT"],
];

// Price history for correlation calculation
const pairPriceHistory: Map<string, number[]> = new Map();

export function updatePairPrice(symbol: string, price: number): void {
  const history = pairPriceHistory.get(symbol) || [];
  history.push(price);
  if (history.length > 200) history.shift();
  pairPriceHistory.set(symbol, history);
}

export function analyzePairCorrelation(symbolA: string, symbolB: string): PairCorrelation | null {
  const histA = pairPriceHistory.get(symbolA);
  const histB = pairPriceHistory.get(symbolB);
  
  if (!histA || !histB || histA.length < 50 || histB.length < 50) return null;

  const len = Math.min(histA.length, histB.length);
  const a = histA.slice(-len);
  const b = histB.slice(-len);

  // Calculate correlation
  const meanA = a.reduce((s, v) => s + v, 0) / len;
  const meanB = b.reduce((s, v) => s + v, 0) / len;
  
  let covAB = 0, varA = 0, varB = 0;
  for (let i = 0; i < len; i++) {
    const dA = a[i] - meanA;
    const dB = b[i] - meanB;
    covAB += dA * dB;
    varA += dA * dA;
    varB += dB * dB;
  }
  
  const correlation = covAB / Math.sqrt(varA * varB + 0.0001);

  // Calculate spread (ratio)
  const spreads = a.map((v, i) => v / b[i]);
  const avgSpread = spreads.reduce((s, v) => s + v, 0) / spreads.length;
  const spreadStd = Math.sqrt(spreads.reduce((s, v) => s + (v - avgSpread) ** 2, 0) / spreads.length);
  const currentSpread = a[len - 1] / b[len - 1];
  const spreadDeviation = (currentSpread - avgSpread) / (spreadStd + 0.0001);

  // Signal: if spread deviates > 2 std devs, bet on reversion
  let signal: PairCorrelation["signal"] = "neutral";
  let strength = 0;

  if (correlation > 0.7) { // Only trade highly correlated pairs
    if (spreadDeviation > 2) {
      signal = "short_a_long_b"; // A is overpriced relative to B
      strength = Math.min(80, spreadDeviation * 20);
    } else if (spreadDeviation < -2) {
      signal = "long_a_short_b"; // A is underpriced relative to B
      strength = Math.min(80, Math.abs(spreadDeviation) * 20);
    }
  }

  return {
    pair: [symbolA, symbolB],
    correlation,
    currentSpread,
    avgSpread,
    spreadDeviation,
    signal,
    strength
  };
}

export function scanPairOpportunities(): PairCorrelation[] {
  const opportunities: PairCorrelation[] = [];
  
  for (const [a, b] of CORRELATED_PAIRS) {
    const result = analyzePairCorrelation(a, b);
    if (result && result.signal !== "neutral") {
      opportunities.push(result);
    }
  }
  
  return opportunities.sort((a, b) => b.strength - a.strength);
}

// ═══════════════════════════════════════════════════════════════
// 13. MOMENTUM CASCADE
// ═══════════════════════════════════════════════════════════════

export interface MomentumCascadeSignal {
  leader: string;
  leaderChange: number;
  followers: { symbol: string; currentChange: number; expectedChange: number; opportunity: number }[];
  bestOpportunity: string;
  strength: number;
}

// Track recent price changes for all symbols
const recentChanges: Map<string, { change5m: number; change15m: number; change1h: number; volume: number }> = new Map();

export function updateMomentumData(symbol: string, change5m: number, change15m: number, change1h: number, volume: number): void {
  recentChanges.set(symbol, { change5m, change15m, change1h, volume });
}

/**
 * Detect momentum cascade: when a leader moves 2%+ in 5min,
 * correlated coins that haven't moved yet are likely to follow
 */
export function detectMomentumCascade(): MomentumCascadeSignal | null {
  if (recentChanges.size < 5) return null;

  // Find the leader (biggest mover in last 5 min)
  let leader = "", maxChange = 0;
  for (const [sym, data] of Array.from(recentChanges)) {
    if (Math.abs(data.change5m) > Math.abs(maxChange) && data.volume > 0) {
      maxChange = data.change5m;
      leader = sym;
    }
  }

  // Need at least 2% move to trigger cascade
  if (Math.abs(maxChange) < 2) return null;

  // Find followers that haven't moved yet
  const followers: MomentumCascadeSignal["followers"] = [];
  const direction = maxChange > 0 ? 1 : -1;

  for (const [sym, data] of Array.from(recentChanges)) {
    if (sym === leader) continue;
    
    // Expected to follow the leader but hasn't moved much yet
    const expectedChange = maxChange * 0.5; // Expect 50% of leader's move
    const currentChange = data.change5m;
    const opportunity = Math.abs(expectedChange) - Math.abs(currentChange);
    
    if (opportunity > 0.5) { // At least 0.5% opportunity
      followers.push({
        symbol: sym,
        currentChange,
        expectedChange,
        opportunity
      });
    }
  }

  if (followers.length === 0) return null;

  followers.sort((a, b) => b.opportunity - a.opportunity);
  const bestOpportunity = followers[0].symbol;
  const strength = Math.min(80, Math.abs(maxChange) * 15 + followers[0].opportunity * 20);

  return {
    leader,
    leaderChange: maxChange,
    followers: followers.slice(0, 5),
    bestOpportunity,
    strength
  };
}

// ═══════════════════════════════════════════════════════════════
// 14. SMART EXIT WITH AI
// ═══════════════════════════════════════════════════════════════

export interface SmartExitSignal {
  shouldExit: boolean;
  reason: string;
  confidence: number;
  optimalExitPrice: number;
  currentProfitPercent: number;
  riskRewardRatio: number;
}

/**
 * Predict optimal exit point using multiple factors:
 * - Momentum decay (volume decreasing while price rising)
 * - Resistance levels approaching
 * - RSI overbought
 * - Pattern completion
 * - Profit target based on ATR
 */
export function calculateSmartExit(
  entryPrice: number,
  currentPrice: number,
  atrPercent: number,
  rsi: number,
  volumeTrend: "increasing" | "decreasing" | "stable",
  resistanceLevels: number[],
  regime: string,
  holdTimeMinutes: number
): SmartExitSignal {
  const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
  let shouldExit = false;
  let reason = "";
  let confidence = 0;

  // Calculate optimal exit based on ATR
  const atrTarget = atrPercent * 1.5; // Target 1.5x ATR as profit
  const optimalExitPrice = entryPrice * (1 + atrTarget / 100);

  // Risk/reward ratio
  const riskRewardRatio = profitPercent / Math.max(0.5, atrPercent);

  // EXIT SIGNALS (all require minimum 0.5% profit — NEVER sell at loss)
  if (profitPercent < 0.5) {
    return {
      shouldExit: false,
      reason: `Profit ${profitPercent.toFixed(2)}% < 0.5% minimum — HOLD`,
      confidence: 0,
      optimalExitPrice,
      currentProfitPercent: profitPercent,
      riskRewardRatio
    };
  }

  // 1. Momentum exhaustion: volume decreasing while in profit
  if (volumeTrend === "decreasing" && profitPercent > 1.0 && rsi > 65) {
    shouldExit = true;
    confidence = 70;
    reason = `Momentum exhaustion: volume declining, RSI ${rsi.toFixed(0)}, profit ${profitPercent.toFixed(2)}%`;
  }

  // 2. RSI extremely overbought
  if (rsi > 80 && profitPercent > 0.5) {
    shouldExit = true;
    confidence = Math.max(confidence, 80);
    reason = `RSI overbought (${rsi.toFixed(0)}), profit ${profitPercent.toFixed(2)}% — take profit`;
  }

  // 3. Approaching strong resistance
  const nearestResistance = resistanceLevels.find(r => r > currentPrice && ((r - currentPrice) / currentPrice) < 0.005);
  if (nearestResistance && profitPercent > 0.5) {
    shouldExit = true;
    confidence = Math.max(confidence, 65);
    reason = `Near resistance $${nearestResistance.toFixed(2)}, profit ${profitPercent.toFixed(2)}%`;
  }

  // 4. Profit exceeds ATR target (take the win)
  if (profitPercent >= atrTarget && atrTarget > 0.5) {
    shouldExit = true;
    confidence = Math.max(confidence, 85);
    reason = `Hit ATR target: ${profitPercent.toFixed(2)}% >= ${atrTarget.toFixed(2)}% — optimal exit`;
  }

  // 5. Extended hold time with decent profit
  if (holdTimeMinutes > 120 && profitPercent > 0.8) {
    shouldExit = true;
    confidence = Math.max(confidence, 60);
    reason = `Extended hold (${(holdTimeMinutes / 60).toFixed(1)}h) with ${profitPercent.toFixed(2)}% — lock in gains`;
  }

  // 6. Regime change to volatile while in profit
  if (regime === "volatile" && profitPercent > 0.7) {
    shouldExit = true;
    confidence = Math.max(confidence, 75);
    reason = `Volatile regime with ${profitPercent.toFixed(2)}% profit — secure gains before reversal`;
  }

  return {
    shouldExit,
    reason: reason || `Hold — profit ${profitPercent.toFixed(2)}%, target ${atrTarget.toFixed(2)}%`,
    confidence,
    optimalExitPrice,
    currentProfitPercent: profitPercent,
    riskRewardRatio
  };
}

// ═══════════════════════════════════════════════════════════════
// 15. NEWS TRADING (Real-time crypto news processing)
// ═══════════════════════════════════════════════════════════════

export interface NewsSignal {
  hasNews: boolean;
  impact: "high" | "medium" | "low" | "none";
  direction: "buy" | "sell" | "neutral";
  strength: number;
  headline: string;
  reason: string;
}

const newsCache: Map<string, { data: NewsSignal; ts: number }> = new Map();
const NEWS_TTL = 5 * 60 * 1000; // 5 min cache

export async function getNewsSignal(symbol: string): Promise<NewsSignal> {
  const cached = newsCache.get(symbol);
  if (cached && Date.now() - cached.ts < NEWS_TTL) return cached.data;

  const coin = symbol.replace("USDT", "").replace("PERP", "");
  const defaultResult: NewsSignal = { hasNews: false, impact: "none", direction: "neutral", strength: 0, headline: "", reason: "" };

  try {
    const res = await fetch(
      `https://min-api.cryptocompare.com/data/v2/news/?categories=${coin}&excludeCategories=Sponsored&lang=EN`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();

    if (data?.Data?.length > 0) {
      // Check for very recent news (last 30 min)
      const now = Math.floor(Date.now() / 1000);
      const recentNews = data.Data.filter((n: any) => now - n.published_on < 1800);

      if (recentNews.length > 0) {
        const article = recentNews[0];
        const text = `${article.title} ${article.body || ""}`.toLowerCase();

        // High impact keywords
        const highBullish = ["etf approved", "etf approval", "partnership with", "institutional adoption",
          "all-time high", "ath", "major upgrade", "mainnet launch", "billion dollar"];
        const highBearish = ["hack", "exploit", "sec lawsuit", "ban", "delisted", "fraud",
          "crash", "collapse", "bankruptcy", "emergency"];

        let direction: "buy" | "sell" | "neutral" = "neutral";
        let impact: "high" | "medium" | "low" = "low";
        let strength = 0;

        for (const kw of highBullish) {
          if (text.includes(kw)) { direction = "buy"; impact = "high"; strength = 80; break; }
        }
        for (const kw of highBearish) {
          if (text.includes(kw)) { direction = "sell"; impact = "high"; strength = 80; break; }
        }

        if (impact === "low") {
          // Medium impact analysis
          const bullishCount = ["surge", "rally", "bullish", "growth", "profit", "gain", "upgrade", "launch", "adoption"]
            .filter(kw => text.includes(kw)).length;
          const bearishCount = ["dump", "bearish", "decline", "loss", "warning", "risk", "sell-off", "regulation"]
            .filter(kw => text.includes(kw)).length;

          if (bullishCount >= 3) { direction = "buy"; impact = "medium"; strength = 50; }
          else if (bearishCount >= 3) { direction = "sell"; impact = "medium"; strength = 50; }
          else if (bullishCount > bearishCount) { direction = "buy"; impact = "low"; strength = 25; }
          else if (bearishCount > bullishCount) { direction = "sell"; impact = "low"; strength = 25; }
        }

        const result: NewsSignal = {
          hasNews: true,
          impact,
          direction,
          strength,
          headline: article.title?.substring(0, 100) || "",
          reason: `${impact.toUpperCase()} impact news: "${article.title?.substring(0, 60)}..." → ${direction}`
        };

        newsCache.set(symbol, { data: result, ts: Date.now() });
        return result;
      }
    }
  } catch (e) {
    // Silent fail
  }

  newsCache.set(symbol, { data: defaultResult, ts: Date.now() });
  return defaultResult;
}

// ═══════════════════════════════════════════════════════════════
// AGGREGATE ADVANCED STRATEGIES SIGNAL
// ═══════════════════════════════════════════════════════════════

export interface AdvancedStrategySignal {
  direction: "buy" | "sell" | "neutral";
  confidence: number;
  sizingMultiplier: number;
  reasons: string[];
  momentumCascade: MomentumCascadeSignal | null;
  newsSignal: NewsSignal;
  pairOpportunities: PairCorrelation[];
}

export async function getAdvancedStrategySignal(
  symbol: string,
  currentPrice: number
): Promise<AdvancedStrategySignal> {
  const reasons: string[] = [];
  let buyPoints = 0, sellPoints = 0;
  let sizingMultiplier = 1.0;

  // 1. Momentum Cascade
  const cascade = detectMomentumCascade();
  if (cascade && cascade.followers.some(f => f.symbol === symbol)) {
    const follower = cascade.followers.find(f => f.symbol === symbol)!;
    if (cascade.leaderChange > 0) {
      buyPoints += cascade.strength * 0.5;
      reasons.push(`🚀 Cascade: ${cascade.leader} +${cascade.leaderChange.toFixed(1)}% → ${symbol} expected +${follower.expectedChange.toFixed(1)}%`);
      sizingMultiplier *= 1.2;
    } else {
      sellPoints += cascade.strength * 0.5;
      reasons.push(`📉 Cascade: ${cascade.leader} ${cascade.leaderChange.toFixed(1)}% → ${symbol} expected ${follower.expectedChange.toFixed(1)}%`);
    }
  }

  // 2. News Trading
  const news = await getNewsSignal(symbol);
  if (news.hasNews && news.strength > 20) {
    if (news.direction === "buy") { buyPoints += news.strength * 0.6; sizingMultiplier *= 1.3; }
    else if (news.direction === "sell") { sellPoints += news.strength * 0.6; sizingMultiplier *= 0.7; }
    reasons.push(`📰 News: ${news.reason}`);
  }

  // 3. Pairs Trading opportunities
  const pairOpps = scanPairOpportunities();
  const relevantPair = pairOpps.find(p => p.pair.includes(symbol));
  if (relevantPair) {
    const isA = relevantPair.pair[0] === symbol;
    if (relevantPair.signal === "long_a_short_b" && isA) {
      buyPoints += relevantPair.strength * 0.4;
      reasons.push(`📊 Pairs: ${symbol} undervalued vs ${relevantPair.pair[1]} (${relevantPair.spreadDeviation.toFixed(1)}σ)`);
    } else if (relevantPair.signal === "short_a_long_b" && isA) {
      sellPoints += relevantPair.strength * 0.4;
      reasons.push(`📊 Pairs: ${symbol} overvalued vs ${relevantPair.pair[1]} (${relevantPair.spreadDeviation.toFixed(1)}σ)`);
    } else if (relevantPair.signal === "long_a_short_b" && !isA) {
      sellPoints += relevantPair.strength * 0.4;
      reasons.push(`📊 Pairs: ${symbol} overvalued vs ${relevantPair.pair[0]} (${relevantPair.spreadDeviation.toFixed(1)}σ)`);
    } else if (relevantPair.signal === "short_a_long_b" && !isA) {
      buyPoints += relevantPair.strength * 0.4;
      reasons.push(`📊 Pairs: ${symbol} undervalued vs ${relevantPair.pair[0]} (${relevantPair.spreadDeviation.toFixed(1)}σ)`);
    }
  }

  const netScore = buyPoints - sellPoints;
  const direction = netScore > 10 ? "buy" : netScore < -10 ? "sell" : "neutral";
  const confidence = Math.min(100, Math.abs(netScore));
  sizingMultiplier = Math.max(0.3, Math.min(2.0, sizingMultiplier));

  return {
    direction,
    confidence,
    sizingMultiplier,
    reasons,
    momentumCascade: cascade,
    newsSignal: news,
    pairOpportunities: pairOpps
  };
}
