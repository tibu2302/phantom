import { trpc } from "@/lib/trpc";
import { Bell, Play, Square, AlertTriangle, TrendingUp, TrendingDown, Wallet, Target, Trophy, Activity, BarChart3, Shield, Wifi, WifiOff, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { useState, useMemo } from "react";

const fmt = (n: number) => {
  const abs = Math.abs(n);
  return (n < 0 ? "-" : "+") + "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtUsd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";

export default function Home() {
  const { data, isLoading } = trpc.bot.status.useQuery(undefined, { refetchInterval: 5000 });
  const utils = trpc.useUtils();
  const startBot = trpc.bot.start.useMutation({ onSuccess: () => { utils.bot.status.invalidate(); toast.success("Bot started"); } });
  const stopBot = trpc.bot.stop.useMutation({ onSuccess: () => { utils.bot.status.invalidate(); toast.success("Bot stopped"); } });
  const emergencyStop = trpc.bot.emergencyStop.useMutation({ onSuccess: () => { utils.bot.status.invalidate(); toast.error("Emergency stop executed"); } });
  const markRead = trpc.bot.markNotificationsRead.useMutation({ onSuccess: () => utils.bot.status.invalidate() });
  const [bellOpen, setBellOpen] = useState(false);

  const state = data?.state;
  const totalPnl = parseFloat(String(state?.totalPnl ?? "0"));
  const todayPnl = parseFloat(String(state?.todayPnl ?? "0"));
  const balance = parseFloat(String(state?.currentBalance ?? "5000"));
  const initial = parseFloat(String(state?.initialBalance ?? "5000"));
  const totalTrades = state?.totalTrades ?? 0;
  const winningTrades = state?.winningTrades ?? 0;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const pnlPct = initial > 0 ? (totalPnl / initial) * 100 : 0;
  const isRunning = state?.isRunning ?? false;
  const maxDrawdown = parseFloat(String(state?.maxDrawdown ?? "0"));
  const dailyLoss = parseFloat(String(state?.dailyLoss ?? "0"));
  const unread = data?.unreadNotifications ?? 0;
  const notifications = data?.recentOpportunities ?? [];

  const uptime = useMemo(() => {
    if (!state?.startedAt || !isRunning) return "0m";
    const diff = Date.now() - new Date(state.startedAt).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }, [state?.startedAt, isRunning]);

  const pnlColor = totalPnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]";
  const pnlGlow = totalPnl >= 0 ? "glow-green" : "glow-red";

  const barData = [
    { pair: "BTC", pnl: 0 },
    { pair: "ETH", pnl: 0 },
    { pair: "SP500", pnl: 0 },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-48 glass-card rounded-xl" />
        <div className="grid grid-cols-5 gap-4">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 glass-card rounded-xl" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <div className="flex items-center gap-3 mt-1">
            <Badge variant={isRunning ? "default" : "secondary"} className={isRunning ? "bg-primary/20 text-primary border-primary/30" : ""}>
              {isRunning ? <><span className="w-1.5 h-1.5 rounded-full bg-primary pulse-live mr-1.5 inline-block" /> LIVE</> : <><WifiOff className="h-3 w-3 mr-1" /> OFFLINE</>}
            </Badge>
            {state?.simulationMode && <Badge variant="outline" className="border-[oklch(0.8_0.15_85)] text-[oklch(0.8_0.15_85)]">SIMULATION</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Popover open={bellOpen} onOpenChange={(open) => { setBellOpen(open); if (open && unread > 0) markRead.mutate(); }}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                {unread > 0 && <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold flex items-center justify-center text-white">{unread}</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <div className="p-3 border-b"><h4 className="font-semibold text-sm">Notifications</h4></div>
              <div className="max-h-64 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4 text-center">No notifications yet</p>
                ) : notifications.map((n: any) => (
                  <div key={n.id} className="p-3 border-b last:border-0 hover:bg-accent/50">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{n.symbol}</span>
                      <Badge variant={n.signal === "BUY" ? "default" : "destructive"} className="text-[10px]">{n.signal}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Confidence: {n.confidence}%</p>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {!isRunning ? (
            <Button onClick={() => startBot.mutate()} className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2" disabled={startBot.isPending}>
              <Play className="h-4 w-4" /> Start
            </Button>
          ) : (
            <Button onClick={() => stopBot.mutate()} variant="secondary" className="gap-2" disabled={stopBot.isPending}>
              <Square className="h-4 w-4" /> Stop
            </Button>
          )}
          <Button onClick={() => emergencyStop.mutate()} variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" disabled={emergencyStop.isPending}>
            <AlertTriangle className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Unified PnL */}
      <div className={`glass-card ${pnlGlow} p-8 text-center`}>
        <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase mb-2">Unified Result</p>
        <p className={`text-5xl md:text-6xl font-bold tracking-tight ${pnlColor} tabular-nums`}>{fmt(totalPnl)}</p>
        <p className={`text-lg mt-1 ${pnlColor}`}>{fmtPct(pnlPct)}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { icon: Wallet, label: "BALANCE", value: fmtUsd(balance) },
          { icon: Target, label: "INITIAL", value: fmtUsd(initial) },
          { icon: todayPnl >= 0 ? TrendingUp : TrendingDown, label: "TODAY", value: fmt(todayPnl), color: todayPnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]" },
          { icon: Trophy, label: "WIN RATE", value: winRate.toFixed(1) + "%" },
          { icon: Activity, label: "TRADES", value: String(totalTrades) },
        ].map((s) => (
          <div key={s.label} className="glass-card p-4 text-center">
            <s.icon className="h-4 w-4 mx-auto text-muted-foreground mb-2" />
            <p className="text-[10px] font-semibold tracking-[0.15em] text-muted-foreground">{s.label}</p>
            <p className={`text-lg font-bold mt-1 tabular-nums ${s.color ?? ""}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">PnL Over Time</h3>
          </div>
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            <TrendingUp className="h-8 w-8 opacity-20 mr-2" /> No data yet
          </div>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-4 w-4 text-[oklch(0.75_0.14_200)]" />
            <h3 className="font-semibold text-sm">PnL by Pair</h3>
          </div>
          <ResponsiveContainer width="100%" height={192}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.008 260)" />
              <XAxis dataKey="pair" tick={{ fontSize: 11, fill: "oklch(0.6 0.01 260)" }} />
              <YAxis tick={{ fontSize: 10, fill: "oklch(0.6 0.01 260)" }} />
              <Tooltip contentStyle={{ background: "oklch(0.18 0.008 260)", border: "1px solid oklch(0.25 0.008 260)", borderRadius: 8 }} />
              <Bar dataKey="pnl" fill="oklch(0.72 0.19 160)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Risk Management */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-[oklch(0.8_0.15_85)]" />
            <h3 className="font-semibold text-sm">Risk Management</h3>
          </div>
          <Badge variant="outline" className="border-primary/30 text-primary text-xs">SAFE TO TRADE</Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Max Drawdown</span>
              <span className="tabular-nums">{(maxDrawdown * 100).toFixed(2)}% / 10%</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min((maxDrawdown * 100) / 10 * 100, 100)}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Daily Loss Limit</span>
              <span className="tabular-nums">{fmtUsd(Math.abs(dailyLoss))} / $250</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-[oklch(0.8_0.15_85)] rounded-full transition-all" style={{ width: `${Math.min((Math.abs(dailyLoss) / 250) * 100, 100)}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground py-2">
        <span className="flex items-center gap-1.5">{isRunning ? <Wifi className="h-3 w-3 text-primary" /> : <WifiOff className="h-3 w-3" />} {isRunning ? "Connected" : "Disconnected"}</span>
        <span className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> Uptime: {uptime}</span>
        <span>Cycles: {totalTrades}</span>
        <span>{new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
