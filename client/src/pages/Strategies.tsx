import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Zap, Grid3X3, LineChart } from "lucide-react";
import { toast } from "sonner";

export default function Strategies() {
  const { data: strategies, isLoading } = trpc.strategies.list.useQuery();
  const utils = trpc.useUtils();
  const toggleMut = trpc.strategies.toggle.useMutation({
    onSuccess: () => { utils.strategies.list.invalidate(); toast.success("Estrategia actualizada"); },
  });

  if (isLoading) return <div className="space-y-4 animate-pulse"><div className="h-64 glass-card rounded-xl" /></div>;

  const marketLabel = (m: string | null) => m === "tradfi" ? "TradFi" : "Crypto";
  const stratIcon = (s: string | null) => s === "grid" ? Grid3X3 : LineChart;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Zap className="h-6 w-6 text-primary" /> Estrategias</h1>
        <p className="text-sm text-muted-foreground mt-1">Gestioná tus estrategias de trading activas</p>
      </div>

      {!strategies || strategies.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Zap className="h-10 w-10 text-primary/30 mx-auto mb-3" />
          <p className="text-muted-foreground">Sin estrategias configuradas. Guardá tus Claves API primero para crear las estrategias por defecto.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {strategies.map((s: any) => {
            const Icon = stratIcon(s.strategyType);
            const pnl = parseFloat(String(s.pnl ?? "0"));
            const trades = s.totalTrades ?? 0;
            const wins = s.winningTrades ?? 0;
            const wr = trades > 0 ? (wins / trades * 100).toFixed(1) : "0.0";
            return (
              <div key={s.id} className="glass-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-bold">{s.symbol}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px]">{(s.strategyType ?? "grid").toUpperCase()}</Badge>
                        <Badge variant="outline" className="text-[10px]">{marketLabel(s.market)}</Badge>
                      </div>
                    </div>
                  </div>
                  <Switch checked={s.enabled} onCheckedChange={(checked) => toggleMut.mutate({ id: s.id, enabled: checked })} />
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground font-semibold tracking-wider">PNL</p>
                    <p className={`text-sm font-bold tabular-nums ${pnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>
                      {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-semibold tracking-wider">OPERACIONES</p>
                    <p className="text-sm font-bold tabular-nums">{trades}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-semibold tracking-wider">% GANANCIA</p>
                    <p className="text-sm font-bold tabular-nums">{wr}%</p>
                  </div>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Asignación: {s.allocationPct ?? 0}%</span>
                  <span>{s.enabled ? "Activa" : "Pausada"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
