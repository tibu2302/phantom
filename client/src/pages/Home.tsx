import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Bell, Play, Square, AlertTriangle, TrendingUp, Activity, Zap,
  BarChart3, Clock, Target, Shield, Ghost, Wifi, WifiOff, Eye, EyeOff,
  ArrowUpRight, ArrowDownRight, CircleDot
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Area, AreaChart } from "recharts";

function formatUsd(val: string | number | null | undefined): string {
  const n = Number(val || 0);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCompact(val: number): string {
  if (Math.abs(val) >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
  if (Math.abs(val) >= 1000) return `${(val / 1000).toFixed(1)}K`;
  return val.toFixed(2);
}

export default function Home() {
  const utils = trpc.useUtils();
  const { data: botData, isLoading } = trpc.bot.status.useQuery(undefined, { refetchInterval: 5000 });
  const { data: pnlData } = trpc.pnl.history.useQuery({ limit: 50 }, { refetchInterval: 10000 });
  const { data: opps } = trpc.opportunities.list.useQuery({ limit: 10 }, { refetchInterval: 15000 });
  const markRead = trpc.opportunities.markRead.useMutation({ onSuccess: () => utils.bot.status.invalidate() });
  const startBot = trpc.bot.start.useMutation({ onSuccess: () => { utils.bot.status.invalidate(); toast.success("PHANTOM activated"); } });
  const stopBot = trpc.bot.stop.useMutation({ onSuccess: () => { utils.bot.status.invalidate(); toast.success("PHANTOM deactivated"); } });
  const emergencyStop = trpc.bot.emergency.useMutation({ onSuccess: () => { utils.bot.status.invalidate(); toast.error("Emergency protocol executed"); } });
  const [notifOpen, setNotifOpen] = useState(false);
  const [hideBalance, setHideBalance] = useState(false);

  const state = botData?.state;
  const strats = botData?.strategies || [];
  const prices = botData?.prices || [];
  const unread = botData?.unreadAlerts || 0;
  const totalPnl = Number(state?.totalPnl || 0);
  const initialBal = Number(state?.initialBalance || 5000);
  const currentBal = Number(state?.currentBalance || 5000);
  const dailyPnl = Number(state?.dailyPnl || 0);
  const totalTrades = state?.totalTrades || 0;
  const winRate = totalTrades > 0 ? ((state?.winningTrades || 0) / totalTrades * 100) : 0;
  const drawdown = Number(state?.maxDrawdown || 0);
  const dailyLoss = Number(state?.dailyLoss || 0);
  const isRunning = state?.status === "running";

  const pnlChartData = useMemo(() => {
    if (!pnlData) return [];
    return [...pnlData].reverse().map((p, i) => ({ idx: i, pnl: Number(p.totalPnl), bal: Number(p.balance) }));
  }, [pnlData]);

  const stratChartData = useMemo(() => {
    return strats.map(s => ({ symbol: s.symbol, pnl: Number(s.pnl || 0), market: s.market }));
  }, [strats]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <Ghost className="h-10 w-10 text-primary animate-pulse" />
            <div className="absolute inset-0 h-10 w-10 bg-primary/20 rounded-full blur-xl animate-pulse" />
          </div>
          <p className="text-sm text-muted-foreground tracking-wider">Loading PHANTOM...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ═══ Top Control Bar ═══ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <Badge
            variant="outline"
            className={`text-[10px] font-semibold tracking-wider ${
              isRunning
                ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                : "border-muted-foreground/30 text-muted-foreground"
            }`}
          >
            <CircleDot className={`h-2.5 w-2.5 mr-1 ${isRunning ? "text-emerald-400 pulse-live" : ""}`} />
            {isRunning ? "LIVE" : "OFFLINE"}
          </Badge>
          {state?.simulationMode && (
            <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/5 tracking-wider">
              SIMULATION
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Notification Bell */}
          <Popover open={notifOpen} onOpenChange={(o) => { setNotifOpen(o); if (o && unread > 0) markRead.mutate(); }}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" className="relative h-9 w-9 border-border/50 bg-card/50">
                <Bell className="h-4 w-4" />
                {unread > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center text-white shadow-lg shadow-red-500/30">
                    {unread}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0 glass-strong" align="end">
              <div className="p-3 border-b border-border/50">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-primary" /> Smart Alerts
                </h3>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {(!opps || opps.length === 0) ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">
                    <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    No alerts yet
                  </div>
                ) : opps.map((o) => (
                  <div key={o.id} className="p-3 border-b border-border/30 hover:bg-accent/30 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm">{o.symbol}</span>
                      <Badge className={`text-[10px] ${o.signal.includes("buy") ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-red-500/15 text-red-400 border-red-500/30"}`} variant="outline">
                        {o.signal.includes("buy") ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
                        {o.signal.replace("_", " ").toUpperCase()}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">${formatUsd(o.price)}</span>
                      <span className="text-border">|</span>
                      <span className="text-primary">{o.confidence}%</span> confidence
                    </div>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Hide Balance */}
          <Button variant="outline" size="icon" className="h-9 w-9 border-border/50 bg-card/50" onClick={() => setHideBalance(!hideBalance)}>
            {hideBalance ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>

          {/* Bot Controls */}
          {!isRunning ? (
            <Button
              onClick={() => startBot.mutate()}
              disabled={startBot.isPending}
              className="bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/20 transition-all h-9 px-4"
            >
              <Play className="h-3.5 w-3.5 mr-1.5" /> Start
            </Button>
          ) : (
            <Button
              onClick={() => stopBot.mutate()}
              disabled={stopBot.isPending}
              variant="secondary"
              className="h-9 px-4"
            >
              <Square className="h-3.5 w-3.5 mr-1.5" /> Stop
            </Button>
          )}
          <Button
            onClick={() => emergencyStop.mutate()}
            disabled={emergencyStop.isPending}
            variant="destructive"
            size="icon"
            className="h-9 w-9 shadow-lg shadow-red-600/20"
            title="Emergency Stop"
          >
            <AlertTriangle className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ═══ Live Price Ticker ═══ */}
      {prices.length > 0 && (
        <div className="relative overflow-hidden rounded-lg glass py-2.5 px-1">
          <div className="flex gap-6 animate-ticker whitespace-nowrap">
            {[...prices, ...prices].map((p, i) => (
              <div key={`${p.symbol}-${i}`} className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-medium text-muted-foreground">{p.symbol}</span>
                <span className="text-sm font-semibold font-mono">${formatUsd(p.price)}</span>
                <span className={`text-xs font-medium font-mono flex items-center ${Number(p.change24h) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {Number(p.change24h) >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {Math.abs(Number(p.change24h || 0)).toFixed(2)}%
                </span>
                {i < [...prices, ...prices].length - 1 && <div className="w-px h-3 bg-border/50 ml-4" />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ Unified PnL Hero Card ═══ */}
      <div className={`relative rounded-2xl overflow-hidden ${totalPnl > 0 ? "glow-gain" : totalPnl < 0 ? "glow-loss" : ""}`}>
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-card via-card to-secondary/20" />
        <div className={`absolute inset-0 opacity-[0.03] ${totalPnl >= 0 ? "bg-gradient-to-br from-emerald-500 to-transparent" : "bg-gradient-to-br from-red-500 to-transparent"}`} />
        
        <div className="relative p-6 lg:p-8">
          <div className="text-center mb-8">
            <p className="text-[10px] font-semibold tracking-[0.3em] uppercase text-muted-foreground mb-3">
              Unified Result
            </p>
            <p className={`text-6xl lg:text-7xl font-bold tracking-tighter font-display ${
              totalPnl > 0 ? "text-emerald-400" : totalPnl < 0 ? "text-red-400" : "text-foreground"
            }`}>
              {hideBalance ? "* * * * *" : `${totalPnl >= 0 ? "+" : "-"}$${formatUsd(Math.abs(totalPnl))}`}
            </p>
            <p className={`text-sm mt-2 font-medium ${
              totalPnl > 0 ? "text-emerald-400/70" : totalPnl < 0 ? "text-red-400/70" : "text-muted-foreground"
            }`}>
              {hideBalance ? "---" : initialBal > 0 ? `${totalPnl >= 0 ? "+" : ""}${((totalPnl / initialBal) * 100).toFixed(2)}%` : "0.00%"}
            </p>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 max-w-4xl mx-auto">
            {[
              { label: "Balance", val: hideBalance ? "***" : `$${formatUsd(currentBal)}`, icon: BarChart3, color: "text-foreground" },
              { label: "Initial", val: hideBalance ? "***" : `$${formatUsd(initialBal)}`, icon: Target, color: "text-muted-foreground" },
              { label: "Today", val: dailyPnl, isPnl: true, icon: Zap, color: "" },
              { label: "Win Rate", val: `${winRate.toFixed(1)}%`, icon: TrendingUp, color: winRate >= 50 ? "text-emerald-400" : "text-muted-foreground" },
              { label: "Trades", val: totalTrades.toString(), icon: Activity, color: "text-foreground" },
            ].map((item) => (
              <div key={item.label} className="text-center glass rounded-xl py-3 px-2">
                <item.icon className="h-3.5 w-3.5 mx-auto mb-1.5 text-muted-foreground/60" />
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
                {item.isPnl ? (
                  <p className={`text-base font-bold font-mono mt-0.5 ${Number(item.val) > 0 ? "text-emerald-400" : Number(item.val) < 0 ? "text-red-400" : "text-foreground"}`}>
                    {hideBalance ? "***" : `${Number(item.val) >= 0 ? "+" : ""}$${formatUsd(item.val)}`}
                  </p>
                ) : (
                  <p className={`text-base font-bold font-mono mt-0.5 ${item.color}`}>{item.val as string}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ Strategy Cards ═══ */}
      {strats.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Active Strategies</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {strats.map((s) => {
              const sPnl = Number(s.pnl || 0);
              const sWinRate = (s.trades || 0) > 0 ? ((s.winningTrades || 0) / (s.trades || 1) * 100) : 0;
              return (
                <div key={s.id} className="glass rounded-xl p-4 hover:bg-white/[0.04] transition-all group">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`h-2 w-2 rounded-full ${s.enabled ? "bg-emerald-400 pulse-live" : "bg-muted-foreground/40"}`} />
                      <span className="font-semibold text-sm">{s.symbol}</span>
                    </div>
                    <div className="flex gap-1.5">
                      <Badge variant="outline" className="text-[9px] h-5 border-border/50 bg-card/50">
                        {s.strategyType.toUpperCase()}
                      </Badge>
                      <Badge variant="outline" className={`text-[9px] h-5 ${
                        s.market === "tradfi"
                          ? "border-amber-500/30 text-amber-400 bg-amber-500/5"
                          : "border-blue-400/30 text-blue-400 bg-blue-500/5"
                      }`}>
                        {s.market === "tradfi" ? "TradFi" : "Crypto"}
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: "PnL", val: `${sPnl >= 0 ? "+" : ""}$${formatCompact(sPnl)}`, color: sPnl > 0 ? "text-emerald-400" : sPnl < 0 ? "text-red-400" : "text-foreground" },
                      { label: "Trades", val: (s.trades || 0).toString(), color: "text-foreground" },
                      { label: "Win", val: `${sWinRate.toFixed(0)}%`, color: sWinRate >= 50 ? "text-emerald-400" : "text-muted-foreground" },
                      { label: "Balance", val: hideBalance ? "***" : `$${formatCompact(Number(s.balance || 0))}`, color: "text-foreground" },
                    ].map((stat) => (
                      <div key={stat.label} className="text-center">
                        <p className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">{stat.label}</p>
                        <p className={`text-xs font-bold font-mono mt-0.5 ${stat.color}`}>{stat.val}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ Charts ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* PnL Over Time */}
        <div className="glass rounded-xl p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span>PnL Over Time</span>
          </h3>
          {pnlChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={pnlChartData}>
                <defs>
                  <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="idx" hide />
                <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} tickFormatter={(v) => `$${formatCompact(v)}`} width={55} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "rgba(10,10,20,0.95)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, fontSize: 12, backdropFilter: "blur(20px)" }}
                  formatter={(v: number) => [`$${formatUsd(v)}`, "PnL"]}
                />
                <Area type="monotone" dataKey="pnl" stroke="#34d399" strokeWidth={2} fill="url(#pnlGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground/50 text-sm">
              <div className="text-center">
                <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-20" />
                No data yet
              </div>
            </div>
          )}
        </div>

        {/* PnL by Pair */}
        <div className="glass rounded-xl p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span>PnL by Pair</span>
          </h3>
          {stratChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stratChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="symbol" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} tickFormatter={(v) => `$${formatCompact(v)}`} width={55} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "rgba(10,10,20,0.95)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, fontSize: 12 }}
                  formatter={(v: number) => [`$${formatUsd(v)}`, "PnL"]}
                />
                <Bar dataKey="pnl" radius={[6, 6, 0, 0]}>
                  {stratChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.pnl >= 0 ? "#34d399" : "#f87171"} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground/50 text-sm">
              <div className="text-center">
                <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-20" />
                No data yet
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Risk Management ═══ */}
      <div className="glass rounded-xl p-4">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
          <Shield className="h-4 w-4 text-primary" />
          <span>Risk Management</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-center">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Max Drawdown</span>
              <span className="text-xs font-mono font-medium">{drawdown.toFixed(2)}% / 10%</span>
            </div>
            <div className="relative h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 rounded-full transition-all ${drawdown < 5 ? "bg-emerald-500" : drawdown < 8 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${Math.min((drawdown / 10) * 100, 100)}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Daily Loss Limit</span>
              <span className="text-xs font-mono font-medium">${formatUsd(Math.abs(dailyLoss))} / $250</span>
            </div>
            <div className="relative h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 rounded-full transition-all ${Math.abs(dailyLoss) < 125 ? "bg-emerald-500" : Math.abs(dailyLoss) < 200 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${Math.min((Math.abs(dailyLoss) / 250) * 100, 100)}%` }}
              />
            </div>
          </div>
          <div className="flex items-center justify-center">
            <Badge
              variant="outline"
              className={`px-4 py-1.5 text-xs font-semibold tracking-wider ${
                drawdown < 8 && Math.abs(dailyLoss) < 200
                  ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                  : "border-red-500/40 text-red-400 bg-red-500/10"
              }`}
            >
              {drawdown < 8 && Math.abs(dailyLoss) < 200 ? (
                <><Shield className="h-3.5 w-3.5 mr-1.5" /> SAFE TO TRADE</>
              ) : (
                <><AlertTriangle className="h-3.5 w-3.5 mr-1.5" /> RISK ALERT</>
              )}
            </Badge>
          </div>
        </div>
      </div>

      {/* ═══ Footer Status ═══ */}
      <div className="flex items-center justify-center gap-6 text-[11px] text-muted-foreground/50 pb-4">
        <span className="flex items-center gap-1.5">
          {isRunning ? <Wifi className="h-3 w-3 text-emerald-400" /> : <WifiOff className="h-3 w-3" />}
          {isRunning ? "Connected" : "Disconnected"}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="h-3 w-3" /> Uptime: {Math.floor((state?.uptime || 0) / 60)}m
        </span>
        <span>Cycles: {state?.cycles || 0}</span>
        <span>{new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
