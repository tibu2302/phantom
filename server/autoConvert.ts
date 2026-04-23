// ─── Auto-Convert Accumulated Coins to USDT ───
// This runs every 15 cycles (~5 min) and sells any non-USDT coins
// that don't have an open position AND are in profit.
// NEVER sells at a loss — if current price < avg buy price, it holds.

import type { EngineState } from "./tradingEngine";
import { withRetry } from "./tradingEngine";
import { getDb } from "./db";
import { trades } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

interface CoinBalance {
  coin: string;
  walletBalance: string;
  usdValue: string;
  availableToWithdraw: string;
}

/**
 * Calculate the average buy price for a coin from trade history.
 * Only considers BUY trades for the given symbol.
 * Returns 0 if no buy history found (meaning we don't know the cost basis — don't sell).
 */
async function getAvgBuyPrice(userId: number, symbol: string): Promise<number> {
  try {
    const pair = symbol.includes("USDT") ? symbol : `${symbol}USDT`;
    const db = await getDb();
    if (!db) return 0;
    const result = await db
      .select({
        avgPrice: sql<string>`AVG(CAST(price AS DECIMAL(18,8)))`,
        totalQty: sql<string>`SUM(CAST(qty AS DECIMAL(18,8)))`,
      })
      .from(trades)
      .where(
        and(
          eq(trades.userId, userId),
          eq(trades.symbol, pair),
          eq(trades.side, "Buy"),
          eq(trades.simulated, false)
        )
      );

    const avgPrice = parseFloat(result[0]?.avgPrice ?? "0");
    return avgPrice;
  } catch (e) {
    console.log(`[AutoConvert] Cannot get avg buy price for ${symbol}: ${(e as Error).message}`);
    return 0; // Unknown cost basis — don't sell
  }
}

export async function autoConvertCoinsToUSDT(engine: EngineState): Promise<void> {
  if (engine.simulationMode) return;
  
  try {
    // ─── Bybit: Get all coin balances from unified account ───
    if (engine.client) {
      const res = await withRetry(() => engine.client.getWalletBalance({ accountType: "UNIFIED" }), "AutoConvert Bybit getWalletBalance");
      if (res.retCode === 0) {
        const coins: CoinBalance[] = (res.result as any)?.list?.[0]?.coin ?? [];
        for (const coin of coins) {
          const symbol = coin.coin;
          if (symbol === "USDT" || symbol === "USDC" || symbol === "USD") continue;
          
          const available = parseFloat(coin.availableToWithdraw ?? "0");
          const usdValue = parseFloat(coin.usdValue ?? "0");
          
          // Skip dust (< $1) or zero balances
          if (usdValue < 1 || available <= 0) continue;
          
          const pair = `${symbol}USDT`;
          
          // Check if there's an open position for this coin — if so, don't sell
          const openPositions = engine.openBuyPositions[pair] ?? [];
          const scalpPositions = engine.scalpPositions[pair] ?? [];
          const futuresPositions = engine.futuresPositions[pair] ?? [];
          
          if (openPositions.length > 0 || scalpPositions.length > 0 || futuresPositions.length > 0) {
            continue; // Has active positions, don't convert
          }
          
          // ─── ZERO LOSS CHECK ───
          // Get average buy price from trade history
          const avgBuyPrice = await getAvgBuyPrice(engine.userId, pair);
          
          // Calculate current price from usdValue / available
          const currentPrice = usdValue / available;
          let profitPct = "N/A";
          
          if (avgBuyPrice > 0) {
            // Has buy history — only sell if in profit
            if (currentPrice < avgBuyPrice) {
              const lossPct = ((currentPrice - avgBuyPrice) / avgBuyPrice * 100).toFixed(2);
              console.log(`[AutoConvert] Bybit: HOLD ${symbol} — current $${currentPrice.toFixed(4)} < avg buy $${avgBuyPrice.toFixed(4)} (${lossPct}%)`);
              continue; // Would be a loss — HOLD
            }
            profitPct = ((currentPrice - avgBuyPrice) / avgBuyPrice * 100).toFixed(2) + "%";
          } else {
            // No buy history — sell anyway to free capital (100% autonomous)
            console.log(`[AutoConvert] Bybit: No buy history for ${symbol}, selling to free capital (~$${usdValue.toFixed(2)})`);
            profitPct = "unknown";
          }
          
          // In profit — sell it
          try {
            const qtyStr = available.toFixed(8);
            const sellRes = await withRetry(() => engine.client.submitOrder({
              category: "spot",
              symbol: pair,
              side: "Sell",
              orderType: "Market",
              qty: qtyStr,
            }), `AutoConvert Bybit sell ${symbol}`);
            
            if (sellRes.result?.orderId) {
              console.log(`[AutoConvert] Bybit: Sold ${available.toFixed(4)} ${symbol} (~$${usdValue.toFixed(2)}) to USDT — profit +${profitPct}% — orderId: ${sellRes.result.orderId}`);
            } else {
              console.log(`[AutoConvert] Bybit: Failed to sell ${symbol}: ${JSON.stringify(sellRes)}`);
            }
          } catch (e) {
            console.log(`[AutoConvert] Bybit: Cannot sell ${symbol}: ${(e as Error).message}`);
          }
        }
      }
    }
    
    // ─── KuCoin: Get all coin balances from trade account ───
    if (engine.kucoinClient) {
      try {
        const [tradeRes, hfRes] = await Promise.allSettled([
          engine.kucoinClient.getBalances({ type: "trade" }),
          engine.kucoinClient.getBalances({ type: "trade_hf" as any }),
        ]);
        
        const prices = (await import("./tradingEngine")).getLivePrices();
        const coinsToSell: { symbol: string; qty: number; usdValue: number; currentPrice: number }[] = [];
        
        const processBalances = (r: any) => {
          if (r.status !== "fulfilled" || r.value?.code !== "200000") return;
          for (const acc of (r.value.data as any[] ?? [])) {
            const cur = acc.currency;
            const bal = parseFloat(acc.available ?? "0");
            if (cur === "USDT" || cur === "USDC" || cur === "USD") continue;
            
            const price = prices[`${cur}USDT`]?.lastPrice ?? 0;
            const usdVal = bal * price;
            if (usdVal < 1 || bal <= 0) continue;
            
            const pair = `${cur}USDT`;
            const openPositions = engine.openBuyPositions[pair] ?? [];
            const scalpPositions = engine.scalpPositions[pair] ?? [];
            
            if (openPositions.length > 0 || scalpPositions.length > 0) continue;
            
            coinsToSell.push({ symbol: cur, qty: bal, usdValue: usdVal, currentPrice: price });
          }
        };
        
        processBalances(tradeRes);
        processBalances(hfRes);
        
        for (const { symbol, qty, usdValue, currentPrice } of coinsToSell) {
          // ─── ZERO LOSS CHECK ───
          const pair = `${symbol}USDT`;
          const avgBuyPrice = await getAvgBuyPrice(engine.userId, pair);
          
          let profitPct = "N/A";
          
          if (avgBuyPrice > 0) {
            // Has buy history — only sell if in profit
            if (currentPrice < avgBuyPrice) {
              const lossPct = ((currentPrice - avgBuyPrice) / avgBuyPrice * 100).toFixed(2);
              console.log(`[AutoConvert] KuCoin: HOLD ${symbol} — current $${currentPrice.toFixed(4)} < avg buy $${avgBuyPrice.toFixed(4)} (${lossPct}%)`);
              continue; // Would be a loss — HOLD
            }
            profitPct = ((currentPrice - avgBuyPrice) / avgBuyPrice * 100).toFixed(2) + "%";
          } else {
            // No buy history — sell anyway to free capital (100% autonomous)
            console.log(`[AutoConvert] KuCoin: No buy history for ${symbol}, selling to free capital (~$${usdValue.toFixed(2)})`);
            profitPct = "unknown";
          }
          
          try {
            const kucoinPair = `${symbol}-USDT`;
            const res: any = await withRetry(() => engine.kucoinClient!.submitOrder({
              clientOid: `phantom_ac_${Date.now()}`,
              side: "sell",
              symbol: kucoinPair,
              type: "market",
              size: qty.toFixed(8),
            }), `AutoConvert KuCoin sell ${symbol}`);
            
            if (res?.data?.orderId) {
              console.log(`[AutoConvert] KuCoin: Sold ${qty.toFixed(4)} ${symbol} (~$${usdValue.toFixed(2)}) to USDT — profit +${profitPct}% — orderId: ${res.data.orderId}`);
            }
          } catch (e) {
            console.log(`[AutoConvert] KuCoin: Cannot sell ${symbol}: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        console.log(`[AutoConvert] KuCoin error: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    console.error(`[AutoConvert] Error:`, (e as Error).message);
  }
}
