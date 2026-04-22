# Fee Analysis - Bybit & KuCoin (April 2026)

## Current Code Fees vs Real Fees

### Bybit (Non-VIP)
| Type | Code | Real (Taker) | Real (Maker) | Notes |
|------|------|-------------|-------------|-------|
| Spot | 0.10% | 0.10% | 0.10% | CORRECT |
| Linear (Perp) | 0.055% | 0.055% | 0.02% | CORRECT for taker (market orders) |

### KuCoin (Non-VIP)
| Type | Code | Real (Taker) | Real (Maker) | Notes |
|------|------|-------------|-------------|-------|
| Spot | 0.10% | 0.10% | 0.10% | CORRECT |
| Linear (Perp) | 0.06% | 0.06% | 0.02% | CORRECT for taker |

## Missing Fee: Funding Rate (Perpetual Futures)
- Charged every 8 hours on Bybit perpetuals
- Typically ~0.01% per 8h (0.03% per day) but varies
- POSITIVE rate: longs pay shorts
- NEGATIVE rate: shorts pay longs
- Impact: holding a long for 24h costs ~0.03% extra
- Impact: holding a long for 48h costs ~0.06% extra
- NOT currently accounted for in calcNetPnl!

## Recommendations
1. Fees in code are CORRECT for market (taker) orders - no change needed
2. ADD funding rate estimation to futures PnL calculation
3. For futures held > 8 hours, estimate funding cost at ~0.01% per 8h
4. This makes short-term futures more profitable (less funding paid)
5. Shorts can EARN funding when rate is positive (most of the time in bull markets)
