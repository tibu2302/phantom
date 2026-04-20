import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Sparkles, TrendingUp, TrendingDown } from "lucide-react";

export default function Opportunities() {
  const { data: opps, isLoading } = trpc.opportunities.list.useQuery({ limit: 100 });

  if (isLoading) return <div className="space-y-4 animate-pulse"><div className="h-64 glass-card rounded-xl" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Sparkles className="h-6 w-6 text-primary" /> Smart Opportunities</h1>
        <p className="text-sm text-muted-foreground mt-1">AI-detected trading signals across 30+ coins</p>
      </div>

      {!opps || opps.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Sparkles className="h-10 w-10 text-primary/30 mx-auto mb-3" />
          <p className="text-muted-foreground">No opportunities detected yet. Start the bot to begin scanning.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {opps.map((o: any) => {
            const isBuy = o.signal === "BUY";
            const reasons: string[] = (() => { try { return typeof o.reasons === "string" ? JSON.parse(o.reasons) : Array.isArray(o.reasons) ? o.reasons : []; } catch { return []; } })();
            return (
              <div key={o.id} className="glass-card p-5 hover:border-primary/20 transition-all">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {isBuy ? <TrendingUp className="h-5 w-5 text-[oklch(0.72_0.19_160)]" /> : <TrendingDown className="h-5 w-5 text-[oklch(0.63_0.24_25)]" />}
                    <span className="font-bold">{o.symbol}</span>
                    <Badge variant={isBuy ? "default" : "destructive"}>{o.signal}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono">${parseFloat(String(o.price ?? "0")).toLocaleString()}</span>
                    <Badge variant="outline" className="text-xs">{o.confidence}%</Badge>
                  </div>
                </div>
                {reasons.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {reasons.map((r: string, i: number) => <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{r}</span>)}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-2">{new Date(o.createdAt).toLocaleString()}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
