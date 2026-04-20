import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";

export default function Trades() {
  const { data: trades, isLoading } = trpc.trades.list.useQuery({ limit: 100 });

  if (isLoading) return <div className="space-y-4 animate-pulse"><div className="h-64 glass-card rounded-xl" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><History className="h-6 w-6 text-primary" /> Trade History</h1>
        <p className="text-sm text-muted-foreground mt-1">All executed trades</p>
      </div>

      {!trades || trades.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <History className="h-10 w-10 text-primary/30 mx-auto mb-3" />
          <p className="text-muted-foreground">No trades executed yet. Start the bot to begin trading.</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/30">
                  <th className="text-left p-3 font-medium text-muted-foreground">Symbol</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Side</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Price</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Qty</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">PnL</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Strategy</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Time</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t: any) => {
                  const pnl = parseFloat(String(t.pnl ?? "0"));
                  return (
                    <tr key={t.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                      <td className="p-3 font-medium">{t.symbol}</td>
                      <td className="p-3">
                        <Badge variant={t.side === "BUY" ? "default" : "destructive"} className="text-[10px]">{t.side}</Badge>
                      </td>
                      <td className="p-3 text-right font-mono">${parseFloat(String(t.price)).toLocaleString()}</td>
                      <td className="p-3 text-right font-mono">{t.qty}</td>
                      <td className={`p-3 text-right font-mono font-semibold ${pnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>
                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                      </td>
                      <td className="p-3"><Badge variant="outline" className="text-[10px]">{t.strategy}</Badge></td>
                      <td className="p-3 text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</td>
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
