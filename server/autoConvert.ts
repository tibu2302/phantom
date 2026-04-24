// ─── Auto-Convert ALL Coins to USDT ───
// v10.4: AGGRESSIVE MODE — sell ALL non-USDT coins immediately
// No profit threshold — we want 100% of capital in USDT for linear trading
// The small loss on spot positions is worth it to free capital for XAU scalping

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
    return 0;
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
          
          // v10.4: SELL EVERYTHING — no position check for spot coins
          // Linear positions don't hold actual coins, so spot balances are always stale
          // Only skip if there's an active futures position (which uses margin, not coins)
          const futuresPositions = engine.futuresPositions[pair] ?? [];
          if (futuresPositions.length > 0) continue;
          
          // Calculate profit/loss for logging only
          const avgBuyPrice = await getAvgBuyPrice(engine.userId, pair);
          const currentPrice = usdValue / available;
          let profitInfo = "";
          
          if (avgBuyPrice > 0) {
            const profitPctNum = (currentPrice - avgBuyPrice) / avgBuyPrice;
            const pctStr = (profitPctNum * 100).toFixed(2);
            profitInfo = `${profitPctNum >= 0 ? "+" : ""}${pctStr}% (avg=$${avgBuyPrice.toFixed(4)})`;
          } else {
            profitInfo = "no buy history";
          }
          
          // v10.4: FORCE SELL — no profit threshold, free ALL capital to USDT
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
              console.log(`[AutoConvert] Bybit: FORCE SOLD ${available.toFixed(4)} ${symbol} (~$${usdValue.toFixed(2)}) to USDT — ${profitInfo} — orderId: ${sellRes.result.orderId}`);
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
            
            coinsToSell.push({ symbol: cur, qty: bal, usdValue: usdVal, currentPrice: price });
          }
        };
        
        processBalances(tradeRes);
        processBalances(hfRes);
        
        for (const { symbol, qty, usdValue, currentPrice } of coinsToSell) {
          // v10.4: FORCE SELL — no profit check, liquidate everything to USDT
          const pair = `${symbol}USDT`;
          const avgBuyPrice = await getAvgBuyPrice(engine.userId, pair);
          let profitInfo = "";
          
          if (avgBuyPrice > 0) {
            const profitPctNum = (currentPrice - avgBuyPrice) / avgBuyPrice;
            profitInfo = `${profitPctNum >= 0 ? "+" : ""}${(profitPctNum * 100).toFixed(2)}%`;
          } else {
            profitInfo = "no buy history";
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
              console.log(`[AutoConvert] KuCoin: FORCE SOLD ${qty.toFixed(4)} ${symbol} (~$${usdValue.toFixed(2)}) to USDT — ${profitInfo} — orderId: ${res.data.orderId}`);
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
