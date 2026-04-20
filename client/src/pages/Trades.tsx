import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { History, Ghost, ArrowUpRight, ArrowDownRight } from "lucide-react";

function formatUsd(val: string | number | null | undefined): string {
  const n = Number(val || 0);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TradesPage() {
  const { data: trades, isLoading } = trpc.trades.recent.useQuery({ limit: 50 }, { refetchInterval: 10000 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <History className="h-5 w-5 text-primary" /> Trade History
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Complete record of all executed trades.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Ghost className="h-6 w-6 text-primary animate-pulse" />
        </div>
      ) : (!trades || trades.length === 0) ? (
        <div className="glass rounded-xl p-12 text-center">
          <History className="h-12 w-12 mx-auto text-muted-foreground/20 mb-4" />
          <p className="text-sm text-muted-foreground">No trades executed yet.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Start the bot to begin trading.</p>
        </div>
      ) : (
        <div className="glass rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left p-3.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Time</th>
                  <th className="text-left p-3.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Symbol</th>
                  <th className="text-left p-3.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Side</th>
                  <th className="text-right p-3.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Price</th>
                  <th className="text-right p-3.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Qty</th>
                  <th className="text-right p-3.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">PnL</th>
                  <th className="text-left p-3.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Strategy</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const pnl = Number(t.pnl || 0);
                  const isBuy = t.side === "buy";
                  return (
                    <tr key={t.id} className="border-b border-border/20 hover:bg-white/[0.02] transition-colors">
                      <td className="p-3.5 text-xs text-muted-foreground font-mono">{new Date(t.createdAt).toLocaleString()}</td>
                      <td className="p-3.5 font-semibold text-sm">{t.symbol}</td>
                      <td className="p-3.5">
                        <Badge variant="outline" className={`text-[9px] tracking-wider ${isBuy ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-red-500/10 text-red-400 border-red-500/30"}`}>
                          {isBuy ? <ArrowUpRight className="h-2.5 w-2.5 mr-0.5" /> : <ArrowDownRight className="h-2.5 w-2.5 mr-0.5" />}
                          {t.side.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="p-3.5 text-right font-mono text-sm">${formatUsd(t.price)}</td>
                      <td className="p-3.5 text-right font-mono text-sm text-muted-foreground">{t.qty}</td>
                      <td className={`p-3.5 text-right font-bold font-mono text-sm ${pnl > 0 ? "text-emerald-400" : pnl < 0 ? "text-red-400" : "text-foreground"}`}>
                        {pnl >= 0 ? "+" : ""}${formatUsd(pnl)}
                      </td>
                      <td className="p-3.5">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/80 text-muted-foreground">{t.strategy}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
