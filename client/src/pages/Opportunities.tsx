import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, TrendingUp, TrendingDown, CheckCheck, Ghost, ArrowUpRight, ArrowDownRight, Zap } from "lucide-react";
import { toast } from "sonner";

function formatUsd(val: string | number | null | undefined): string {
  const n = Number(val || 0);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function OpportunitiesPage() {
  const utils = trpc.useUtils();
  const { data: opps, isLoading } = trpc.opportunities.list.useQuery({ limit: 50 }, { refetchInterval: 15000 });
  const { data: unread } = trpc.opportunities.unreadCount.useQuery(undefined, { refetchInterval: 10000 });
  const markRead = trpc.opportunities.markRead.useMutation({
    onSuccess: () => { utils.opportunities.unreadCount.invalidate(); utils.opportunities.list.invalidate(); toast.success("All marked as read"); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Smart Opportunities
          </h1>
          <p className="text-sm text-muted-foreground mt-1">AI-detected signals across 30+ assets — RSI, EMA, Volume, Bollinger Bands.</p>
        </div>
        {(unread || 0) > 0 && (
          <Button variant="outline" size="sm" onClick={() => markRead.mutate()} className="border-border/50 bg-card/50 h-8 text-xs">
            <CheckCheck className="h-3.5 w-3.5 mr-1.5" /> Mark all read
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Ghost className="h-6 w-6 text-primary animate-pulse" />
        </div>
      ) : (!opps || opps.length === 0) ? (
        <div className="glass rounded-xl p-12 text-center">
          <Sparkles className="h-12 w-12 mx-auto text-muted-foreground/20 mb-4" />
          <p className="text-sm text-muted-foreground">No opportunities detected yet.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">The scanner runs every 2 minutes.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {opps.map((o) => {
            const isBuy = o.signal.includes("buy");
            return (
              <div
                key={o.id}
                className={`glass rounded-xl p-4 hover:bg-white/[0.03] transition-all relative overflow-hidden ${
                  !o.isRead ? "ring-1 ring-primary/20" : ""
                }`}
              >
                {/* Subtle gradient accent */}
                <div className={`absolute top-0 left-0 right-0 h-px ${isBuy ? "bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" : "bg-gradient-to-r from-transparent via-red-500/50 to-transparent"}`} />
                
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${isBuy ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                      {isBuy ? <ArrowUpRight className="h-4 w-4 text-emerald-400" /> : <ArrowDownRight className="h-4 w-4 text-red-400" />}
                    </div>
                    <span className="font-semibold">{o.symbol}</span>
                    {!o.isRead && <div className="h-1.5 w-1.5 rounded-full bg-primary pulse-live" />}
                  </div>
                  <Badge variant="outline" className={`text-[9px] tracking-wider ${isBuy ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-red-500/10 text-red-400 border-red-500/30"}`}>
                    {o.signal.replace("_", " ").toUpperCase()}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <p className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">Price</p>
                    <p className="text-sm font-bold font-mono">${formatUsd(o.price)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">Confidence</p>
                    <div className="flex items-center gap-1.5">
                      <p className={`text-sm font-bold font-mono ${o.confidence >= 70 ? "text-emerald-400" : o.confidence >= 50 ? "text-amber-400" : "text-muted-foreground"}`}>
                        {o.confidence}%
                      </p>
                      {o.confidence >= 70 && <Zap className="h-3 w-3 text-emerald-400" />}
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">Time</p>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5">{new Date(o.createdAt).toLocaleTimeString()}</p>
                  </div>
                </div>

                {Array.isArray(o.reasons) && o.reasons.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(o.reasons as unknown as string[]).map((r: string, i: number) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/80 text-muted-foreground">{r}</span>
                    ))}
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
