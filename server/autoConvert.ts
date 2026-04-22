// ─── Auto-Convert Accumulated Coins to USDT ───
// This runs every 15 cycles (~5 min) and sells any non-USDT coins
// that don't have an open position, converting them back to USDT
// to keep capital liquid and available for new trades.

import type { EngineState } from "./tradingEngine";

interface CoinBalance {
  coin: string;
  walletBalance: string;
  usdValue: string;
  availableToWithdraw: string;
}

export async function autoConvertCoinsToUSDT(engine: EngineState): Promise<void> {
  if (engine.simulationMode) return;
  
  try {
    // ─── Bybit: Get all coin balances from unified account ───
    if (engine.client) {
      const res = await engine.client.getWalletBalance({ accountType: "UNIFIED" });
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
          
          // No open positions — this is leftover capital, sell it to USDT
          try {
            const qtyStr = available.toFixed(8);
            const sellRes = await engine.client.submitOrder({
              category: "spot",
              symbol: pair,
              side: "Sell",
              orderType: "Market",
              qty: qtyStr,
            });
            
            if (sellRes.result?.orderId) {
              console.log(`[AutoConvert] Bybit: Sold ${available.toFixed(4)} ${symbol} (~$${usdValue.toFixed(2)}) to USDT — orderId: ${sellRes.result.orderId}`);
            } else {
              console.log(`[AutoConvert] Bybit: Failed to sell ${symbol}: ${JSON.stringify(sellRes)}`);
            }
          } catch (e) {
            // Some coins might not have a USDT pair or qty might be below minimum
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
        const coinsToSell: { symbol: string; qty: number; usdValue: number }[] = [];
        
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
            
            coinsToSell.push({ symbol: cur, qty: bal, usdValue: usdVal });
          }
        };
        
        processBalances(tradeRes);
        processBalances(hfRes);
        
        for (const { symbol, qty, usdValue } of coinsToSell) {
          try {
            const kucoinPair = `${symbol}-USDT`;
            const res = await engine.kucoinClient.submitOrder({
              clientOid: `phantom_ac_${Date.now()}`,
              side: "sell",
              symbol: kucoinPair,
              type: "market",
              size: qty.toFixed(8),
            });
            
            if (res?.data?.orderId) {
              console.log(`[AutoConvert] KuCoin: Sold ${qty.toFixed(4)} ${symbol} (~$${usdValue.toFixed(2)}) to USDT — orderId: ${res.data.orderId}`);
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
