import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Activity, Ghost } from "lucide-react";
import { toast } from "sonner";

function formatUsd(val: string | number | null | undefined): string {
  const n = Number(val || 0);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function StrategiesPage() {
  const utils = trpc.useUtils();
  const { data: strats, isLoading } = trpc.strategies.list.useQuery(undefined, { refetchInterval: 10000 });
  const toggle = trpc.strategies.toggle.useMutation({
    onSuccess: () => { utils.strategies.list.invalidate(); toast.success("Strategy updated"); },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" /> Strategies
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your active trading strategies across Crypto and TradFi markets.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Ghost className="h-6 w-6 text-primary animate-pulse" />
        </div>
      ) : (!strats || strats.length === 0) ? (
        <div className="glass rounded-xl p-12 text-center">
          <Activity className="h-12 w-12 mx-auto text-muted-foreground/20 mb-4" />
          <p className="text-sm text-muted-foreground">No strategies configured.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Save your API keys first to activate strategies.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {strats.map((s) => {
            const pnl = Number(s.pnl || 0);
            const winRate = (s.trades || 0) > 0 ? ((s.winningTrades || 0) / (s.trades || 1) * 100) : 0;
            return (
              <div key={s.id} className="glass rounded-xl p-5 hover:bg-white/[0.03] transition-all">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`h-2.5 w-2.5 rounded-full ${s.enabled ? "bg-emerald-400 pulse-live" : "bg-muted-foreground/40"}`} />
                    <span className="text-lg font-bold">{s.symbol}</span>
                    <Badge variant="outline" className="text-[9px] tracking-wider border-border/50 bg-card/50 h-5">
                      {s.strategyType.toUpperCase()}
                    </Badge>
                    <Badge variant="outline" className={`text-[9px] tracking-wider h-5 ${
                      s.market === "tradfi"
                        ? "border-amber-500/30 text-amber-400 bg-amber-500/5"
                        : "border-blue-400/30 text-blue-400 bg-blue-500/5"
                    }`}>
                      {s.market === "tradfi" ? "TradFi" : "Crypto"}
                    </Badge>
                  </div>
                  <Switch
                    checked={s.enabled}
                    onCheckedChange={(checked) => toggle.mutate({ id: s.id, enabled: checked })}
                  />
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
                  {[
                    { label: "PnL", val: `${pnl >= 0 ? "+" : ""}$${formatUsd(pnl)}`, color: pnl > 0 ? "text-emerald-400" : pnl < 0 ? "text-red-400" : "text-foreground" },
                    { label: "Balance", val: `$${formatUsd(s.balance)}`, color: "text-foreground" },
                    { label: "Trades", val: (s.trades || 0).toString(), color: "text-foreground" },
                    { label: "Win Rate", val: `${winRate.toFixed(0)}%`, color: winRate >= 50 ? "text-emerald-400" : "text-muted-foreground" },
                    { label: "Allocation", val: `${s.allocationPct}%`, color: "text-foreground" },
                    { label: "Category", val: s.category, color: "text-muted-foreground" },
                  ].map((stat) => (
                    <div key={stat.label}>
                      <p className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">{stat.label}</p>
                      <p className={`text-base font-bold font-mono mt-0.5 ${stat.color}`}>{stat.val}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
