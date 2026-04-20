import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Sparkles, TrendingUp, TrendingDown } from "lucide-react";

const fmtPrice = (n: number) => {
  if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
};

export default function Opportunities() {
  const { data: opps, isLoading } = trpc.opportunities.list.useQuery({ limit: 100 });

  if (isLoading) return (
    <div className="space-y-3 animate-pulse">
      <div className="h-8 glass-card rounded-xl w-56" />
      {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 glass-card rounded-xl" />)}
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Oportunidades</h1>
        <p className="text-xs text-muted-foreground mt-1">Señales detectadas por el escáner en +30 monedas</p>
      </div>

      {!opps || opps.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Sparkles className="h-10 w-10 text-primary/30 mx-auto mb-3" />
          <p className="text-muted-foreground">Sin oportunidades detectadas aún. Iniciá el bot para comenzar a escanear.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {opps.map((o: any) => {
            const isBuy = String(o.signal).includes("BUY");
            const confidence = parseInt(String(o.confidence ?? "0"), 10);
            const confidenceColor = confidence >= 80
              ? "text-[oklch(0.72_0.19_160)]"
              : confidence >= 60
                ? "text-[oklch(0.8_0.15_85)]"
                : "text-muted-foreground";
            const reasons: string[] = (() => { try { return typeof o.reasons === "string" ? JSON.parse(o.reasons) : Array.isArray(o.reasons) ? o.reasons : []; } catch { return []; } })();
            return (
              <div key={o.id} className="glass-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${isBuy ? "bg-[oklch(0.72_0.19_160/15%)]" : "bg-[oklch(0.63_0.24_25/15%)]"}`}>
                      {isBuy ? <TrendingUp className="h-4 w-4 text-[oklch(0.72_0.19_160)]" /> : <TrendingDown className="h-4 w-4 text-[oklch(0.63_0.24_25)]" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-base">{o.symbol}</span>
                        <Badge variant={isBuy ? "default" : "destructive"} className="text-[10px] px-2">{isBuy ? "COMPRA" : "VENTA"}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        ${fmtPrice(parseFloat(String(o.price ?? "0")))}
                        {" · "}
                        {new Date(o.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-xl font-bold tabular-nums ${confidenceColor}`}>{confidence}%</p>
                    <p className="text-[10px] text-muted-foreground">confianza</p>
                  </div>
                </div>
                {reasons.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {reasons.map((r: string, i: number) => <span key={i} className="text-[10px] bg-secondary/60 text-muted-foreground px-2 py-0.5 rounded-full border border-border/50">{r}</span>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
