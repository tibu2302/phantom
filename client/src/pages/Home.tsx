import {
  Bell, Play, Square, AlertTriangle, TrendingUp, TrendingDown,
  Wallet, Target, Trophy, Activity, BarChart3, Shield, Wifi, WifiOff,
  Clock, Zap, ArrowUpRight, ArrowDownRight, RefreshCw, Eye, EyeOff,
  ChevronRight, Flame, Pencil, DollarSign, Percent, Award, Scale,
  Calendar, PieChart, Layers, ArrowUp, ArrowDown, Minus, Brain,
  Cpu, Gauge, CircleDollarSign, TrendingUp as Trending, LayoutGrid,
  Crosshair, Bot, Sparkles, LineChart, FileDown, Gem, Crown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, Line, ComposedChart,
  ResponsiveContainer, CartesianGrid, PieChart as RPieChart, Pie, Cell
} from "recharts";
import { toast } from "sonner";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useIsMobile } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";

// ─── Formatters ───
const fmt = (n: number) => {
  const abs = Math.abs(n);
  return (n < 0 ? "-" : "+") + "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtUsd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
const fmtPrice = (n: number) => {
  if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
};

// ─── Period labels ───
type Period = "today" | "7d" | "30d" | "year" | "all";
const periodLabels: Record<Period, string> = { today: "Hoy", "7d": "7D", "30d": "30D", year: "Anual", all: "Todo" };

// ─── Strategy config ───
const strategyColors: Record<string, string> = {
  grid: "oklch(0.72 0.19 160)", scalping: "oklch(0.75 0.14 200)",
  futures: "oklch(0.65 0.2 300)", unknown: "oklch(0.6 0.01 260)",
};
const strategyLabels: Record<string, string> = { grid: "Grid", scalping: "Scalping", futures: "Futures" };

// ─── AI Modules list ───
const aiModules = [
  { name: "Smart Analysis", icon: Brain, status: "active" },
  { name: "Master Signal", icon: Crosshair, status: "active" },
  { name: "Sentiment AI", icon: Sparkles, status: "active" },
  { name: "Pattern Recognition", icon: LineChart, status: "active" },
  { name: "Anomaly Detection", icon: Shield, status: "active" },
  { name: "Reinforcement Learning", icon: Cpu, status: "active" },
  { name: "Auto-Optimizer", icon: Gauge, status: "active" },
  { name: "Capital Allocator", icon: Scale, status: "active" },
  { name: "Profit Maximizer", icon: TrendingUp, status: "active" },
  { name: "Market Timing", icon: Clock, status: "active" },
  { name: "Breakout Hunter", icon: Zap, status: "active" },
  { name: "USDT Liquidity Guard", icon: CircleDollarSign, status: "active" },
];

// ─── Daily Target Progress Ring ───
function DailyTargetRing({ current, target, size = 90 }: { current: number; target: number; size?: number }) {
  const pct = Math.min(Math.max(current / target, 0), 1.5);
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - pct * circumference;
  const isOver = current >= target;
  const color = isOver ? "oklch(0.72 0.19 160)" : current >= target * 0.5 ? "oklch(0.8 0.15 85)" : "oklch(0.65 0.2 300)";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="oklch(0.15 0.005 260)" strokeWidth={5} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={circumference} strokeDashoffset={Math.max(offset, 0)}
          strokeLinecap="round" className="progress-ring transition-all duration-1000" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[10px] font-bold tabular-nums" style={{ color }}>{(pct * 100).toFixed(0)}%</span>
        <span className="text-[7px] text-muted-foreground/40">de meta</span>
      </div>
    </div>
  );
}

export default function Home() {
  const isMobile = useIsMobile();
  const { data, isLoading, refetch: refetchStatus } = trpc.bot.status.useQuery(undefined, { refetchInterval: 5000, retry: false });
  const publicPrices = trpc.prices.live.useQuery(undefined, { refetchInterval: 8000 });
  const strategiesQuery = trpc.strategies.list.useQuery(undefined, { retry: false });
  const tradesQuery = trpc.trades.list.useQuery({ limit: 50 }, { retry: false });
  const pnlHistory = trpc.pnl.history.useQuery({ days: 14 }, { retry: false, staleTime: 60_000 });
  const exchangeBalances = trpc.bot.exchangeBalances.useQuery(undefined, { refetchInterval: 30_000, retry: false });
  const utils = trpc.useUtils();

  const [selectedPeriod, setSelectedPeriod] = useState<Period>("today");
  const advancedStats = trpc.pnl.advancedStats.useQuery({ period: selectedPeriod }, { retry: false, staleTime: 30_000 });

  const startBot = trpc.bot.start.useMutation({
    onSuccess: (res: any) => { utils.bot.status.invalidate(); if (res.success) toast.success("Motor PHANTOM iniciado"); else toast.error(res.error || "Error al iniciar"); },
    onError: () => toast.error("Error al iniciar el motor"),
  });
  const stopBot = trpc.bot.stop.useMutation({ onSuccess: () => { utils.bot.status.invalidate(); toast.success("Motor detenido"); } });
  const emergencyStop = trpc.bot.emergencyStop.useMutation({ onSuccess: () => { utils.bot.status.invalidate(); toast.error("PARADA DE EMERGENCIA ejecutada"); } });
  const markRead = trpc.bot.markNotificationsRead.useMutation({ onSuccess: () => utils.bot.status.invalidate() });

  const [bellOpen, setBellOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hideBalances, setHideBalances] = useState(false);
  const [editDepositOpen, setEditDepositOpen] = useState(false);
  const [editDepositValue, setEditDepositValue] = useState("");
  const [showAiModules, setShowAiModules] = useState(false);

  useEffect(() => { const t = setInterval(() => setCurrentTime(new Date()), 1000); return () => clearInterval(t); }, []);

  const handleRefresh = useCallback(async () => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(30);
    setIsRefreshing(true);
    await Promise.all([utils.bot.status.invalidate(), utils.prices.live.invalidate(), utils.pnl.advancedStats.invalidate(), utils.bot.exchangeBalances.invalidate()]);
    setTimeout(() => setIsRefreshing(false), 800);
  }, [utils]);

  const state = data?.state;
  const isRunning = data?.engineRunning ?? false;
  const maxDrawdown = parseFloat(String(state?.maxDrawdown ?? "0"));
  const dailyLoss = parseFloat(String(state?.dailyLoss ?? "0"));
  const unread = data?.unreadNotifications ?? 0;
  const notifications = data?.recentOpportunities ?? [];
  const selectedExchange = (state as any)?.selectedExchange ?? "bybit";
  const openPositions = (data as any)?.openPositions ?? { grid: [], futures: [] };
  const totalOpenPositions = (openPositions.grid?.length ?? 0) + (openPositions.futures?.length ?? 0);

  const eb = exchangeBalances.data;
  const bybitBal = parseFloat(eb?.bybit?.balance ?? "0");
  const bybitAvail = parseFloat(eb?.bybit?.available ?? "0");
  const bybitUnrealized = parseFloat(eb?.bybit?.unrealizedPnl ?? "0");
  const kucoinBal = parseFloat(eb?.kucoin?.balance ?? "0");
  const kucoinAvail = parseFloat(eb?.kucoin?.available ?? "0");
  const totalBalance = parseFloat(eb?.totalBalance ?? "0");
  const initialDeposit = parseFloat(eb?.initialDeposit ?? "2500");
  const realProfit = parseFloat(eb?.realProfit ?? "0");
  const realProfitPct = parseFloat(eb?.realProfitPct ?? "0");
  const todayPnl = parseFloat(eb?.todayPnl ?? "0");
  const yesterdayPnl = parseFloat(eb?.yesterdayPnl ?? "0");
  const weekPnl = parseFloat(eb?.weekPnl ?? "0");
  const yearPnl = parseFloat(eb?.yearPnl ?? "0");
  const todayTrades = eb?.todayTrades ?? 0;
  const totalTrades = eb?.totalTrades ?? 0;
  const winRate = parseFloat(eb?.winRate ?? "0");
  const unrealizedPnl = parseFloat(eb?.openPositions?.unrealizedPnl ?? "0");
  const openPosCount = eb?.openPositions?.count ?? totalOpenPositions;

  // USDT liquidity calculation
  const totalUsdt = bybitAvail + kucoinAvail;
  const usdtPct = totalBalance > 0 ? (totalUsdt / totalBalance) * 100 : 0;
  const usdtHealthy = usdtPct >= 40;

  // Daily target
  const DAILY_TARGET = 300;
  const dailyProgress = todayPnl / DAILY_TARGET;

  const updateSettings = trpc.bot.updateSettings.useMutation({
    onSuccess: () => { utils.bot.status.invalidate(); utils.bot.exchangeBalances.invalidate(); },
  });
  const handleSaveDeposit = () => {
    const val = parseFloat(editDepositValue);
    if (isNaN(val) || val < 0) { toast.error("Monto invalido"); return; }
    updateSettings.mutate({ initialBalance: val.toFixed(2) });
    setEditDepositOpen(false);
    toast.success(`Capital invertido actualizado: ${fmtUsd(val)}`);
  };
  const exchangeLabel = (ex: string) => ex === "kucoin" ? "KuCoin" : ex === "bybit" ? "Bybit" : "Ambos";
  const handleExchangeChange = (exchange: string) => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(15);
    if (isRunning) { toast.error("Detene el bot antes de cambiar de exchange"); return; }
    updateSettings.mutate({ selectedExchange: exchange });
    toast.success(`Exchange: ${exchangeLabel(exchange)}`);
  };

  const livePrices = (data?.livePrices && Object.keys(data.livePrices).length > 0) ? data.livePrices : (publicPrices.data ?? {});

  const uptime = useMemo(() => {
    if (!state?.startedAt || !isRunning) return null;
    const diff = Date.now() - new Date(state.startedAt).getTime();
    const d = Math.floor(diff / 86400000); const h = Math.floor((diff % 86400000) / 3600000); const m = Math.floor((diff % 3600000) / 60000);
    if (d > 0) return `${d}d ${h}h`; if (h > 0) return `${h}h ${m}m`; return `${m}m`;
  }, [state?.startedAt, isRunning, currentTime]);

  const pnlColor = realProfit >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]";
  const todayColor = todayPnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]";
  const yesterdayColor = yesterdayPnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]";
  const weekColor = weekPnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]";
  const yearColor = yearPnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]";

  const tickerPairs = [
    { symbol: "XAUUSDT", label: "XAU/USD", icon: "Au", color: "oklch(0.8 0.15 85)", isGold: true },
    { symbol: "BTCUSDT", label: "BTC", icon: "\u20bf", color: "oklch(0.8 0.15 85)", isGold: false },
    { symbol: "ETHUSDT", label: "ETH", icon: "\u039e", color: "oklch(0.75 0.14 200)", isGold: false },
    { symbol: "SP500", label: "S&P", icon: "SP", color: "oklch(0.65 0.2 300)", isGold: false },
  ];

  const as = advancedStats.data;
  const stratBreakdown = as?.strategyBreakdown ?? {};
  const topSymbols = as?.topSymbols ?? [];
  const pnlChartData = as?.pnlChart ?? [];
  const balanceChartData = (as as any)?.balanceChart ?? [];

  const pieData = Object.entries(stratBreakdown)
    .filter(([_, v]) => v.trades > 0)
    .map(([key, v]) => ({ name: strategyLabels[key] || key, value: Math.abs(v.pnl), pnl: v.pnl, color: strategyColors[key] || strategyColors.unknown }));

  const strategies = strategiesQuery.data ?? [];
  const barData = strategies.length > 0
    ? strategies.map((s: any) => ({ pair: s.symbol.replace("USDT", ""), pnl: parseFloat(String(s.pnl ?? "0")) })).filter((d: any) => d.pnl !== 0)
    : [];

  if (isLoading && publicPrices.isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-14 glass-card rounded-2xl" />
        <div className="h-44 glass-card rounded-2xl" />
        <div className="grid grid-cols-2 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 glass-card rounded-2xl" />)}</div>
      </div>
    );
  }

  // ─── Shared Components ───
  const depositDialog = (
    <Dialog open={editDepositOpen} onOpenChange={setEditDepositOpen}>
      <DialogContent className="sm:max-w-[340px]" style={{ background: 'oklch(0.14 0.005 260)', border: '1px solid oklch(1 0 0 / 10%)' }}>
        <DialogHeader><DialogTitle className="text-foreground">Capital Invertido</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-xs text-muted-foreground">Monto total depositado en los exchanges.</p>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-bold">$</span>
            <Input type="number" step="0.01" min="0" value={editDepositValue} onChange={(e) => setEditDepositValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSaveDeposit()} className="text-lg font-bold tabular-nums" placeholder="2500.00" autoFocus />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setEditDepositOpen(false)}>Cancelar</Button>
            <Button className="flex-1" onClick={handleSaveDeposit}>Guardar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  const periodPills = (
    <div className="flex gap-0.5 bg-[oklch(0.11_0.005_260)] rounded-xl p-0.5 border border-border/10">
      {(Object.keys(periodLabels) as Period[]).map(p => (
        <button key={p} onClick={() => setSelectedPeriod(p)}
          className={`flex-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold tracking-wide transition-all duration-200 ${
            selectedPeriod === p ? "bg-[oklch(0.18_0.01_260)] text-primary shadow-sm border border-primary/15" : "text-muted-foreground/50 hover:text-foreground/70"
          }`}>{periodLabels[p]}</button>
      ))}
    </div>
  );

  const notifPopover = (
    <Popover open={bellOpen} onOpenChange={(open) => { setBellOpen(open); if (open && unread > 0) markRead.mutate(); }}>
      <PopoverTrigger asChild>
        <button className="relative h-9 w-9 flex items-center justify-center rounded-xl hover:bg-accent/50 transition-all active:scale-95">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {unread > 0 && <span className="absolute top-0.5 right-0.5 h-4 min-w-4 px-1 rounded-full bg-destructive text-[9px] font-bold flex items-center justify-center text-white animate-pulse">{unread > 9 ? "9+" : unread}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 glass-card-elevated" align="end">
        <div className="p-3 border-b border-border/30"><h4 className="font-semibold text-sm">Notificaciones</h4></div>
        <div className="max-h-64 overflow-y-auto">
          {notifications.length === 0 ? <p className="text-sm text-muted-foreground p-4 text-center">Sin notificaciones</p> : notifications.map((n: any) => (
            <div key={n.id} className="p-3 border-b border-border/20 last:border-0 hover:bg-accent/20 transition-colors">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{n.symbol}</span>
                <Badge variant={String(n.signal).includes("BUY") ? "default" : "destructive"} className="text-[10px]">{String(n.signal).includes("BUY") ? "COMPRA" : "VENTA"}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Confianza: {n.confidence}%</p>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );

  // ════════════════════════════════════════════════════════════════
  // ─── MOBILE LAYOUT ───
  // ════════════════════════════════════════════════════════════════
  if (isMobile) {
    return (
      <>{depositDialog}
      <div className="space-y-3 pb-2">
        {/* ── Header ── */}
        <div className="flex items-center justify-between fade-in-up" style={{ animationDelay: '0ms' }}>
          <div className="flex gap-0.5 bg-[oklch(0.13_0.005_260)] rounded-xl p-0.5 border border-border/20">
            {["bybit", "kucoin", "both"].map(ex => (
              <button key={ex} onClick={() => handleExchangeChange(ex)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wide transition-all duration-300 ${
                  selectedExchange === ex ? "bg-primary text-primary-foreground shadow-md shadow-primary/25" : "text-muted-foreground/60 hover:text-foreground"
                }`}>{exchangeLabel(ex)}</button>
            ))}
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={() => { const d = new Date().toISOString().slice(0,10); window.open(`/api/report/daily?date=${d}`, '_blank'); }} className="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-accent/50 transition-all active:scale-95" title="Descargar reporte PDF">
              <FileDown className="h-4 w-4 text-muted-foreground" />
            </button>
            <button onClick={() => setHideBalances(!hideBalances)} className="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-accent/50 transition-all active:scale-95">
              {hideBalances ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
            </button>
            <button onClick={handleRefresh} className="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-accent/50 transition-all active:scale-95">
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
            {notifPopover}
          </div>
        </div>

        {/* ── Status Bar ── */}
        <div className="flex items-center gap-2 fade-in-up" style={{ animationDelay: '50ms' }}>
          <Badge variant={isRunning ? "default" : "secondary"} className={`text-[10px] px-2.5 py-1 ${isRunning ? "bg-primary/15 text-primary border border-primary/30" : "border border-border/50"}`}>
            {isRunning ? <><span className="w-1.5 h-1.5 rounded-full bg-primary pulse-live mr-1.5 inline-block" />EN VIVO</> : <><WifiOff className="h-3 w-3 mr-1" />OFFLINE</>}
          </Badge>
          {state?.simulationMode && <Badge variant="outline" className="text-[10px] border-[oklch(0.8_0.15_85)]/50 text-[oklch(0.8_0.15_85)]">SIM</Badge>}
          {uptime && <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{uptime}</span>}
          <div className="flex-1" />
          {!isRunning ? (
            <Button onClick={() => startBot.mutate()} size="sm" className="h-9 px-5 text-xs font-bold gap-1.5 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-95" disabled={startBot.isPending}>
              <Play className="h-3.5 w-3.5" />{startBot.isPending ? "..." : "Iniciar"}
            </Button>
          ) : (
            <div className="flex gap-1.5">
              <Button onClick={() => stopBot.mutate()} variant="secondary" size="sm" className="h-9 px-3 text-xs font-semibold active:scale-95" disabled={stopBot.isPending}><Square className="h-3.5 w-3.5" /></Button>
              <Button onClick={() => emergencyStop.mutate()} variant="destructive" size="sm" className="h-9 px-3 text-xs font-semibold active:scale-95" disabled={emergencyStop.isPending}><AlertTriangle className="h-3.5 w-3.5" /></Button>
            </div>
          )}
        </div>

        {/* ── XAU Gold Ticker (Featured) ── */}
        <div className="fade-in-up" style={{ animationDelay: '100ms' }}>
          {(() => {
            const xauPrice = (livePrices as any)["XAUUSDT"];
            const price = xauPrice?.lastPrice ?? 0;
            const change = xauPrice?.price24hPcnt ? xauPrice.price24hPcnt * 100 : 0;
            const isUp = change >= 0;
            return (
              <div className="glass-card xau-glow p-3 interactive-card">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black float-particle" style={{ background: 'linear-gradient(135deg, oklch(0.8 0.15 85 / 20%), oklch(0.75 0.18 70 / 15%))', color: 'oklch(0.8 0.15 85)' }}>Au</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black">XAU/USD</span>
                        <Crown className="h-3.5 w-3.5 text-[oklch(0.8_0.15_85)]" />
                        <Badge className="text-[7px] px-1.5 py-0 h-4 bg-[oklch(0.8_0.15_85)]/15 text-[oklch(0.8_0.15_85)] border-[oklch(0.8_0.15_85)]/25">50% CAPITAL</Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground/40">Activo principal - Linear USDT</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-black tabular-nums block">{price > 0 ? "$" + fmtPrice(price) : "--"}</span>
                    {price > 0 && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${isUp ? "text-[oklch(0.72_0.19_160)] bg-[oklch(0.72_0.19_160)]/8" : "text-[oklch(0.63_0.24_25)] bg-[oklch(0.63_0.24_25)]/8"}`}>{isUp ? "+" : ""}{change.toFixed(2)}%</span>}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── Other Price Tickers ── */}
        <div className="overflow-x-auto -mx-4 px-4 scrollbar-none fade-in-up" style={{ animationDelay: '150ms' }}>
          <div className="flex gap-2" style={{ width: "max-content" }}>
            {tickerPairs.filter(t => !t.isGold).map(({ symbol, label, icon, color }) => {
              const p = (livePrices as any)[symbol]; const price = p?.lastPrice ?? 0; const change = p?.price24hPcnt ? p.price24hPcnt * 100 : 0; const isUp = change >= 0;
              return (
                <div key={symbol} className="flex items-center gap-2.5 glass-card px-3 py-2 interactive-card">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black" style={{ background: `color-mix(in oklch, ${color} 12%, transparent)`, color }}>{icon}</div>
                  <div>
                    <span className="text-[10px] text-muted-foreground/60 font-medium">{label}</span>
                    <span className="text-[12px] font-bold tabular-nums block">{price > 0 ? "$" + fmtPrice(price) : "--"}</span>
                  </div>
                  {price > 0 && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${isUp ? "text-[oklch(0.72_0.19_160)] bg-[oklch(0.72_0.19_160)]/8" : "text-[oklch(0.63_0.24_25)] bg-[oklch(0.63_0.24_25)]/8"}`}>{isUp ? "+" : ""}{change.toFixed(1)}%</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Balance Hero Card + Daily Target ── */}
        <div className="relative overflow-hidden rounded-2xl fade-in-up" style={{ animationDelay: '200ms', background: 'linear-gradient(145deg, oklch(0.16 0.03 160) 0%, oklch(0.13 0.015 200) 50%, oklch(0.12 0.008 260) 100%)', border: '1px solid oklch(0.72 0.19 160 / 10%)' }}>
          <div className="absolute top-0 right-0 w-40 h-40 bg-primary/5 rounded-full blur-[60px] -translate-y-10 translate-x-10" />
          <div className="relative p-5">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-bold tracking-[0.2em] text-muted-foreground/60 uppercase">Balance Total</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${realProfitPct >= 0 ? 'bg-primary/15 text-primary border border-primary/20' : 'bg-destructive/15 text-destructive border border-destructive/20'}`}>{fmtPct(realProfitPct)}</span>
                </div>
                <p className="text-[38px] font-black tracking-tight tabular-nums leading-none count-up">{hideBalances ? "--------" : fmtUsd(totalBalance)}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <p className="text-[9px] text-muted-foreground/40 tabular-nums">Invertido: {hideBalances ? "---" : fmtUsd(initialDeposit)}</p>
                  <button onClick={() => { setEditDepositValue(initialDeposit.toFixed(2)); setEditDepositOpen(true); }} className="text-muted-foreground/30 hover:text-primary transition-colors"><Pencil className="h-2.5 w-2.5" /></button>
                </div>
              </div>
              {/* Daily Target Ring */}
              <div className="ml-3 flex flex-col items-center">
                <DailyTargetRing current={todayPnl} target={DAILY_TARGET} size={72} />
                <span className="text-[7px] text-muted-foreground/30 mt-0.5 tabular-nums">${DAILY_TARGET}/dia</span>
              </div>
            </div>

            {/* PnL Summary Row */}
            <div className="mt-4 pt-3 border-t border-white/[0.05]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[8px] font-bold tracking-[0.15em] text-muted-foreground/50 uppercase">Ganancia Hoy</span>
                <span className={`text-lg font-black tabular-nums ${todayColor}`}>{hideBalances ? "----" : fmt(todayPnl)}</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <div className="bg-white/[0.03] rounded-xl p-2 text-center">
                  <span className="text-[7px] text-muted-foreground/40 font-medium block">Hoy</span>
                  <span className={`text-[12px] font-bold tabular-nums ${todayColor}`}>{hideBalances ? "--" : fmt(todayPnl)}</span>
                </div>
                <div className="bg-white/[0.03] rounded-xl p-2 text-center">
                  <span className="text-[7px] text-muted-foreground/40 font-medium block">Ayer</span>
                  <span className={`text-[12px] font-bold tabular-nums ${yesterdayColor}`}>{hideBalances ? "--" : fmt(yesterdayPnl)}</span>
                </div>
                <div className="bg-white/[0.03] rounded-xl p-2 text-center">
                  <span className="text-[7px] text-muted-foreground/40 font-medium block">Semana</span>
                  <span className={`text-[12px] font-bold tabular-nums ${weekColor}`}>{hideBalances ? "--" : fmt(weekPnl)}</span>
                </div>
                <div className="bg-white/[0.03] rounded-xl p-2 text-center">
                  <span className="text-[7px] text-muted-foreground/40 font-medium block">Año</span>
                  <span className={`text-[12px] font-bold tabular-nums ${yearColor}`}>{hideBalances ? "--" : fmt(yearPnl)}</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                <div className="bg-white/[0.03] rounded-xl p-2 text-center">
                  <span className="text-[7px] text-muted-foreground/40 font-medium block">Abierto ({openPosCount})</span>
                  <span className={`text-[12px] font-bold tabular-nums ${unrealizedPnl >= 0 ? 'text-[oklch(0.75_0.14_200)]' : 'text-[oklch(0.8_0.15_85)]'}`}>{hideBalances ? "--" : fmt(unrealizedPnl)}</span>
                </div>
                <div className="bg-white/[0.03] rounded-xl p-2 text-center">
                  <span className="text-[7px] text-muted-foreground/40 font-medium block">Futuros PnL</span>
                  <span className={`text-[12px] font-bold tabular-nums ${bybitUnrealized >= 0 ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.63_0.24_25)]'}`}>{hideBalances ? "--" : fmt(bybitUnrealized)}</span>
                </div>
                <div className="bg-white/[0.03] rounded-xl p-2 text-center">
                  <span className="text-[7px] text-muted-foreground/40 font-medium block">Trades Hoy</span>
                  <span className="text-[12px] font-bold tabular-nums text-primary">{todayTrades}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Engine Status + AI Row ── */}
        <div className="grid grid-cols-2 gap-2 fade-in-up" style={{ animationDelay: '250ms' }}>
          <div className="glass-card p-3 interactive-card">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${usdtHealthy ? 'bg-[oklch(0.72_0.19_160)]/10' : 'bg-[oklch(0.8_0.15_85)]/10'}`}>
                <CircleDollarSign className={`h-3.5 w-3.5 ${usdtHealthy ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.8_0.15_85)]'}`} />
              </div>
              <span className="text-[9px] font-bold tracking-wider text-muted-foreground/50 uppercase">USDT Libre</span>
            </div>
            <p className="text-[16px] font-black tabular-nums">{hideBalances ? "----" : fmtUsd(totalUsdt)}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <div className="flex-1 h-1.5 bg-[oklch(0.12_0.005_260)] rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${usdtHealthy ? 'bg-[oklch(0.72_0.19_160)]' : 'bg-[oklch(0.8_0.15_85)]'}`} style={{ width: `${Math.min(usdtPct, 100)}%` }} />
              </div>
              <span className={`text-[9px] font-bold tabular-nums ${usdtHealthy ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.8_0.15_85)]'}`}>{usdtPct.toFixed(0)}%</span>
            </div>
          </div>
          <button onClick={() => setShowAiModules(!showAiModules)} className="glass-card p-3 interactive-card text-left">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-[oklch(0.65_0.2_300)]/10 flex items-center justify-center">
                <Brain className="h-3.5 w-3.5 text-[oklch(0.65_0.2_300)]" />
              </div>
              <span className="text-[9px] font-bold tracking-wider text-muted-foreground/50 uppercase">IA Activa</span>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[16px] font-black tabular-nums">55+</p>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.72_0.19_160)] pulse-live" />
                <span className="text-[9px] text-[oklch(0.72_0.19_160)] font-bold">ONLINE</span>
              </div>
            </div>
            <p className="text-[8px] text-muted-foreground/30 mt-0.5">Toca para ver modulos</p>
          </button>
        </div>

        {/* ── AI Modules Expandable ── */}
        {showAiModules && (
          <div className="glass-card p-3 animate-in slide-in-from-top-2 duration-300">
            <div className="grid grid-cols-2 gap-1.5">
              {aiModules.map(m => (
                <div key={m.name} className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-[oklch(0.12_0.005_260)]">
                  <m.icon className="h-3 w-3 text-primary/70 shrink-0" />
                  <span className="text-[9px] font-medium text-muted-foreground/70 truncate">{m.name}</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.72_0.19_160)] ml-auto shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Exchange Balances ── */}
        <div className="grid grid-cols-2 gap-2 fade-in-up" style={{ animationDelay: '300ms' }}>
          <div className="glass-card p-3.5 interactive-card">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in oklch, oklch(0.8 0.18 80) 10%, transparent)' }}>
                <Wallet className="h-3 w-3" style={{ color: 'oklch(0.8 0.18 80)' }} />
              </div>
              <span className="text-[9px] font-bold tracking-wider text-muted-foreground/50 uppercase">Bybit</span>
            </div>
            <p className="text-[15px] font-black tabular-nums">{hideBalances ? "----" : fmtUsd(bybitBal)}</p>
            <p className="text-[8px] text-muted-foreground/30 tabular-nums mt-0.5">Libre: {hideBalances ? "--" : fmtUsd(bybitAvail)}</p>
          </div>
          <div className="glass-card p-3.5 interactive-card">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in oklch, oklch(0.75 0.14 170) 10%, transparent)' }}>
                <Wallet className="h-3 w-3" style={{ color: 'oklch(0.75 0.14 170)' }} />
              </div>
              <span className="text-[9px] font-bold tracking-wider text-muted-foreground/50 uppercase">KuCoin</span>
            </div>
            <p className="text-[15px] font-black tabular-nums">{hideBalances ? "----" : fmtUsd(kucoinBal)}</p>
            <p className="text-[8px] text-muted-foreground/30 tabular-nums mt-0.5">Libre: {hideBalances ? "--" : fmtUsd(kucoinAvail)}</p>
          </div>
        </div>

        {/* ── Stats Row ── */}
        <div className="grid grid-cols-4 gap-1.5 fade-in-up" style={{ animationDelay: '350ms' }}>
          <div className="glass-card p-2.5 text-center interactive-card">
            <Trophy className="h-3.5 w-3.5 mx-auto mb-0.5 text-[oklch(0.8_0.15_85)]" />
            <p className="text-[7px] text-muted-foreground/40 font-medium">Win Rate</p>
            <p className="text-[13px] font-black tabular-nums">{winRate.toFixed(1)}%</p>
          </div>
          <div className="glass-card p-2.5 text-center interactive-card">
            <Activity className="h-3.5 w-3.5 mx-auto mb-0.5 text-[oklch(0.65_0.2_300)]" />
            <p className="text-[7px] text-muted-foreground/40 font-medium">Trades</p>
            <p className="text-[13px] font-black tabular-nums">{totalTrades}</p>
          </div>
          <div className="glass-card p-2.5 text-center interactive-card">
            <Zap className="h-3.5 w-3.5 mx-auto mb-0.5 text-primary" />
            <p className="text-[7px] text-muted-foreground/40 font-medium">Hoy</p>
            <p className="text-[13px] font-black tabular-nums">{todayTrades}</p>
          </div>
          <div className="glass-card p-2.5 text-center interactive-card">
            <Flame className="h-3.5 w-3.5 mx-auto mb-0.5 text-[oklch(0.8_0.15_85)]" />
            <p className="text-[7px] text-muted-foreground/40 font-medium">Posiciones</p>
            <p className="text-[13px] font-black tabular-nums">{totalOpenPositions}</p>
          </div>
        </div>

        {/* ── Open Positions ── */}
        {totalOpenPositions > 0 && (
          <div className="glass-card overflow-hidden fade-in-up" style={{ animationDelay: '400ms' }}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/15">
              <div className="flex items-center gap-2">
                <Flame className="h-3.5 w-3.5 text-[oklch(0.8_0.15_85)]" />
                <span className="text-[11px] font-bold">Posiciones Abiertas</span>
              </div>
              <Badge variant="outline" className="text-[9px] font-bold border-border/30 h-5">{totalOpenPositions}</Badge>
            </div>
            <div className="divide-y divide-border/8">
              {[...openPositions.grid, ...openPositions.futures].slice(0, 5).map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-[12px] font-bold ${p.symbol?.includes('XAU') ? 'text-[oklch(0.8_0.15_85)]' : ''}`}>{p.symbol?.replace('USDT', '')}</span>
                    {p.symbol?.includes('XAU') && <Crown className="h-2.5 w-2.5 text-[oklch(0.8_0.15_85)]" />}
                    <span className="text-[9px] text-muted-foreground/40 tabular-nums">@ ${fmtPrice(p.buyPrice)}</span>
                  </div>
                  <span className={`text-[12px] font-bold tabular-nums ${p.unrealizedPnl >= 0 ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.63_0.24_25)]'}`}>{hideBalances ? "--" : fmt(p.unrealizedPnl)}</span>
                </div>
              ))}
              {totalOpenPositions > 5 && <div className="px-4 py-2 text-center"><span className="text-[9px] text-muted-foreground/30">+{totalOpenPositions - 5} mas</span></div>}
            </div>
          </div>
        )}

        {/* ── Rendimiento Detallado ── */}
        <div className="glass-card overflow-hidden fade-in-up" style={{ animationDelay: '450ms' }}>
          <div className="px-4 py-2.5 border-b border-border/15 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5 text-primary" />
              <h3 className="font-bold text-[11px]">Rendimiento</h3>
            </div>
            {advancedStats.isFetching && <RefreshCw className="h-3 w-3 text-muted-foreground/30 animate-spin" />}
          </div>
          <div className="p-4 space-y-3">
            {periodPills}
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-2.5 rounded-xl bg-[oklch(0.72_0.19_160)]/5">
                <ArrowUp className="h-3 w-3 text-[oklch(0.72_0.19_160)] mx-auto mb-0.5" />
                <p className="text-[8px] text-muted-foreground/50">Ganancias</p>
                <p className="text-[12px] font-bold tabular-nums text-[oklch(0.72_0.19_160)]">{hideBalances ? "--" : `+$${(as?.totalGains ?? 0).toFixed(2)}`}</p>
              </div>
              <div className="text-center p-2.5 rounded-xl bg-[oklch(0.63_0.24_25)]/5">
                <ArrowDown className="h-3 w-3 text-[oklch(0.63_0.24_25)] mx-auto mb-0.5" />
                <p className="text-[8px] text-muted-foreground/50">Perdidas</p>
                <p className="text-[12px] font-bold tabular-nums text-[oklch(0.63_0.24_25)]">{hideBalances ? "--" : `-$${(as?.totalLosses ?? 0).toFixed(2)}`}</p>
              </div>
              <div className="text-center p-2.5 rounded-xl" style={{ background: (as?.netProfit ?? 0) >= 0 ? 'oklch(0.72 0.19 160 / 8%)' : 'oklch(0.63 0.24 25 / 8%)', border: `1px solid ${(as?.netProfit ?? 0) >= 0 ? 'oklch(0.72 0.19 160 / 12%)' : 'oklch(0.63 0.24 25 / 12%)'}` }}>
                <DollarSign className={`h-3 w-3 mx-auto mb-0.5 ${(as?.netProfit ?? 0) >= 0 ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.63_0.24_25)]'}`} />
                <p className="text-[8px] text-muted-foreground/50">Neto Real</p>
                <p className={`text-[12px] font-black tabular-nums ${(as?.netProfit ?? 0) >= 0 ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.63_0.24_25)]'}`}>{hideBalances ? "--" : fmt(as?.netProfit ?? 0)}</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { label: "Trades", value: String(as?.totalTrades ?? 0) },
                { label: "Win Rate", value: `${(as?.winRate ?? 0).toFixed(1)}%`, color: "oklch(0.72 0.19 160)" },
                { label: "Ganados", value: String(as?.winTrades ?? 0), color: "oklch(0.72 0.19 160)" },
                { label: "Perdidos", value: String(as?.loseTrades ?? 0), color: "oklch(0.63 0.24 25)" },
              ].map(s => (
                <div key={s.label} className="text-center py-1.5 px-1 rounded-lg bg-[oklch(0.11_0.005_260)]">
                  <p className="text-[8px] text-muted-foreground/40">{s.label}</p>
                  <p className="text-[11px] font-bold tabular-nums" style={s.color ? { color: s.color } : undefined}>{s.value}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: "Profit Factor", value: (as?.profitFactor ?? 0) > 100 ? "\u221e" : (as?.profitFactor ?? 0).toFixed(2), color: (as?.profitFactor ?? 0) >= 1.5 ? "oklch(0.72 0.19 160)" : "oklch(0.8 0.15 85)" },
                { label: "Avg Win", value: hideBalances ? "--" : `+$${(as?.avgWin ?? 0).toFixed(2)}`, color: "oklch(0.72 0.19 160)" },
                { label: "Avg Loss", value: hideBalances ? "--" : `-$${(as?.avgLoss ?? 0).toFixed(2)}`, color: "oklch(0.63 0.24 25)" },
                { label: "Mejor Trade", value: hideBalances ? "--" : fmt(as?.bestTrade ?? 0), color: "oklch(0.72 0.19 160)" },
                { label: "Peor Trade", value: hideBalances ? "--" : fmt(as?.worstTrade ?? 0), color: "oklch(0.63 0.24 25)" },
                { label: "Prom. Diario", value: hideBalances ? "--" : fmt(as?.avgDaily ?? 0), color: (as?.avgDaily ?? 0) >= 0 ? "oklch(0.72 0.19 160)" : "oklch(0.63 0.24 25)" },
              ].map(m => (
                <div key={m.label} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-[oklch(0.11_0.005_260)]">
                  <span className="text-[8px] text-muted-foreground/40 font-medium">{m.label}</span>
                  <span className="text-[10px] font-bold tabular-nums" style={{ color: m.color }}>{m.value}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-[oklch(0.11_0.005_260)]">
                <span className="text-[9px] text-muted-foreground/40">Mejor Dia</span>
                <span className="text-[10px] font-bold tabular-nums text-[oklch(0.72_0.19_160)]">{hideBalances ? "--" : fmt(as?.bestDay ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-[oklch(0.11_0.005_260)]">
                <span className="text-[9px] text-muted-foreground/40">Peor Dia</span>
                <span className="text-[10px] font-bold tabular-nums text-[oklch(0.63_0.24_25)]">{hideBalances ? "--" : fmt(as?.worstDay ?? 0)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Strategy Breakdown ── */}
        {Object.keys(stratBreakdown).length > 0 && (
          <div className="glass-card overflow-hidden fade-in-up" style={{ animationDelay: '500ms' }}>
            <div className="px-4 py-2.5 border-b border-border/15 flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-[oklch(0.65_0.2_300)]" />
              <h3 className="font-bold text-[11px]">PnL por Estrategia</h3>
            </div>
            <div className="p-4">
              {pieData.length > 0 && (
                <div className="flex items-center gap-4 mb-3">
                  <div className="w-20 h-20 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <RPieChart><Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={22} outerRadius={36} paddingAngle={3} strokeWidth={0}>{pieData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}</Pie></RPieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {pieData.map(d => (
                      <div key={d.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ background: d.color }} /><span className="text-[10px] font-medium text-muted-foreground/60">{d.name}</span></div>
                        <span className={`text-[10px] font-bold tabular-nums ${d.pnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>{hideBalances ? "--" : fmt(d.pnl)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {Object.entries(stratBreakdown).map(([key, v]) => {
                const color = strategyColors[key] || strategyColors.unknown;
                const label = strategyLabels[key] || key;
                const wr = (v.wins + v.losses) > 0 ? ((v.wins / (v.wins + v.losses)) * 100).toFixed(0) : "--";
                return (
                  <div key={key} className="flex items-center justify-between py-2 border-b border-border/8 last:border-0">
                    <div className="flex items-center gap-2"><div className="w-1.5 h-7 rounded-full" style={{ background: color }} /><div><span className="text-[11px] font-bold">{label}</span><div className="flex gap-2 mt-0.5"><span className="text-[8px] text-muted-foreground/40">{v.trades} ops</span><span className="text-[8px] text-muted-foreground/40">{wr}% WR</span></div></div></div>
                    <div className="text-right"><span className={`text-[11px] font-bold tabular-nums ${v.pnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>{hideBalances ? "--" : fmt(v.pnl)}</span><div className="flex gap-1 justify-end mt-0.5"><span className="text-[8px] text-[oklch(0.72_0.19_160)]">{v.wins}W</span><span className="text-[8px] text-muted-foreground/20">/</span><span className="text-[8px] text-[oklch(0.63_0.24_25)]">{v.losses}L</span></div></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── PnL Curve Chart ── */}
        {pnlChartData.length > 0 && (
          <div className="glass-card p-4 fade-in-up" style={{ animationDelay: '550ms' }}>
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
              <h3 className="font-bold text-[11px]">Curva PnL ({periodLabels[selectedPeriod]})</h3>
            </div>
            <ResponsiveContainer width="100%" height={130}>
              <AreaChart data={pnlChartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <defs><linearGradient id="pnlGM" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0.3} /><stop offset="95%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.2)' }} tickFormatter={(v) => v?.slice(5)} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.2)' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: 'oklch(0.14 0.005 260)', border: '1px solid oklch(1 0 0 / 10%)', borderRadius: 12, fontSize: 10, padding: '6px 10px' }} formatter={(v: any) => [fmt(parseFloat(v)), 'PnL']} />
                <Area type="monotone" dataKey="pnl" stroke="oklch(0.72 0.19 160)" fill="url(#pnlGM)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── v10.9: Capital Evolution Chart ── */}
        {balanceChartData.length > 1 && (
          <div className="glass-card p-4 fade-in-up" style={{ animationDelay: '575ms' }}>
            <div className="flex items-center gap-2 mb-3">
              <Wallet className="h-3.5 w-3.5 text-[oklch(0.8_0.15_85)]" />
              <h3 className="font-bold text-[11px]">Capital Acumulado ({periodLabels[selectedPeriod]})</h3>
            </div>
            <ResponsiveContainer width="100%" height={150}>
              <ComposedChart data={balanceChartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(0.8 0.15 85)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="oklch(0.8 0.15 85)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.2)' }} tickFormatter={(v: string) => v?.slice(5)} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.2)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${(v/1000).toFixed(1)}k`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.15)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} />
                <Tooltip contentStyle={{ background: 'oklch(0.14 0.005 260)', border: '1px solid oklch(1 0 0 / 10%)', borderRadius: 12, fontSize: 10, padding: '6px 10px' }} formatter={(v: any, name: string) => [name === 'balance' ? `$${parseFloat(v).toLocaleString()}` : `$${parseFloat(v).toFixed(2)}`, name === 'balance' ? 'Capital' : 'PnL Diario']} />
                <Area yAxisId="left" type="monotone" dataKey="balance" stroke="oklch(0.8 0.15 85)" fill="url(#balGrad)" strokeWidth={2} dot={false} />
                <Bar yAxisId="right" dataKey="dailyPnl" radius={[2, 2, 0, 0]} opacity={0.6}>
                  {balanceChartData.map((_: any, idx: number) => <Cell key={idx} fill={(_?.dailyPnl ?? 0) >= 0 ? "oklch(0.72 0.19 160)" : "oklch(0.63 0.24 25)"} />)}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Bar Chart by Symbol ── */}
        {barData.length > 0 && (
          <div className="glass-card p-4 fade-in-up" style={{ animationDelay: '600ms' }}>
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-3.5 w-3.5 text-primary" />
              <h3 className="font-bold text-[11px]">PnL por Par</h3>
            </div>
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={barData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                <XAxis dataKey="pair" tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.3)' }} axisLine={false} />
                <YAxis tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.3)' }} axisLine={false} />
                <Tooltip contentStyle={{ background: 'oklch(0.14 0.005 260)', border: '1px solid oklch(1 0 0 / 10%)', borderRadius: 12, fontSize: 10 }} formatter={(v: any) => [fmt(parseFloat(v)), 'PnL']} />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>{barData.map((entry: any, idx: number) => <Cell key={idx} fill={entry.pnl >= 0 ? "oklch(0.72 0.19 160)" : "oklch(0.63 0.24 25)"} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Top Symbols ── */}
        {topSymbols.length > 0 && (
          <div className="glass-card overflow-hidden fade-in-up" style={{ animationDelay: '650ms' }}>
            <div className="px-4 py-2.5 border-b border-border/15 flex items-center gap-2">
              <Award className="h-3.5 w-3.5 text-[oklch(0.8_0.15_85)]" />
              <h3 className="font-bold text-[11px]">Top Pares ({periodLabels[selectedPeriod]})</h3>
            </div>
            <div className="px-4 py-1">
              {topSymbols.slice(0, 6).map((s: any) => (
                <div key={s.symbol} className="flex items-center justify-between py-2 border-b border-border/8 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold ${s.symbol.includes('XAU') ? 'text-[oklch(0.8_0.15_85)]' : ''}`}>{s.symbol.replace("USDT", "")}</span>
                    {s.symbol.includes('XAU') && <Crown className="h-2.5 w-2.5 text-[oklch(0.8_0.15_85)]" />}
                    <span className="text-[8px] text-muted-foreground/30">{s.trades} ops</span>
                  </div>
                  <span className={`text-[11px] font-bold tabular-nums ${s.pnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>{hideBalances ? "--" : fmt(s.pnl)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Recent Trades ── */}
        <div className="glass-card overflow-hidden fade-in-up" style={{ animationDelay: '700ms' }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/15">
            <div className="flex items-center gap-2"><Zap className="h-3.5 w-3.5 text-primary" /><h3 className="font-bold text-[11px]">Ultimas Operaciones</h3></div>
            {tradesQuery.data && tradesQuery.data.length > 0 && <span className="text-[9px] text-muted-foreground/30 tabular-nums">{tradesQuery.data.length} ops</span>}
          </div>
          <div className="divide-y divide-border/8">
            {(!tradesQuery.data || tradesQuery.data.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground"><Activity className="h-8 w-8 opacity-10 mb-2" /><span className="text-[10px]">Sin operaciones aun</span></div>
            ) : tradesQuery.data.slice(0, 8).map((t: any) => {
              const pnl = parseFloat(String(t.pnl ?? "0")); const date = t.createdAt ? new Date(t.createdAt) : null;
              return (
                <div key={t.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-1 h-7 rounded-full ${t.side === "buy" ? "bg-primary" : pnl >= 0 ? "bg-[oklch(0.72_0.19_160)]" : "bg-[oklch(0.63_0.24_25)]"}`} />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[11px] font-bold ${t.symbol?.includes('XAU') ? 'text-[oklch(0.8_0.15_85)]' : ''}`}>{t.symbol?.replace("USDT", "")}</span>
                        <Badge variant={t.side === "buy" ? "default" : "destructive"} className="text-[7px] px-1 py-0 h-3.5 font-bold">{t.side === "buy" ? "C" : "V"}</Badge>
                        {t.strategy && <span className="text-[7px] text-muted-foreground/30 capitalize">{t.strategy}</span>}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5"><span className="text-[9px] text-muted-foreground/40 tabular-nums">${fmtPrice(parseFloat(String(t.price ?? "0")))}</span>{date && <span className="text-[8px] text-muted-foreground/25">{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}</div>
                    </div>
                  </div>
                  <span className={`text-[11px] font-bold tabular-nums ${pnl > 0 ? "text-[oklch(0.72_0.19_160)]" : pnl < 0 ? "text-[oklch(0.63_0.24_25)]" : "text-muted-foreground/30"}`}>{hideBalances ? "--" : fmt(pnl)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Risk Management ── */}
        <div className="glass-card p-4 fade-in-up" style={{ animationDelay: '750ms' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><Shield className="h-3.5 w-3.5 text-[oklch(0.8_0.15_85)]" /><h3 className="font-bold text-[11px]">Gestion de Riesgo</h3></div>
            <Badge variant="outline" className={`text-[8px] font-bold ${dailyLoss > 200 ? "border-destructive/40 text-destructive bg-destructive/5" : "border-primary/20 text-primary bg-primary/5"}`}>{dailyLoss > 200 ? "ALTO" : "OK"}</Badge>
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-[9px] mb-1.5"><span className="text-muted-foreground/50">Max Drawdown</span><span className="tabular-nums font-bold">{hideBalances ? "--" : `${(maxDrawdown * 100).toFixed(2)}%`} / 10%</span></div>
              <div className="h-1.5 bg-[oklch(0.11_0.005_260)] rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-primary to-[oklch(0.75_0.14_200)] rounded-full transition-all duration-700" style={{ width: `${Math.min((maxDrawdown * 100) / 10 * 100, 100)}%` }} /></div>
            </div>
            <div>
              <div className="flex justify-between text-[9px] mb-1.5"><span className="text-muted-foreground/50">Perdida Diaria</span><span className="tabular-nums font-bold">{hideBalances ? "--" : fmtUsd(Math.abs(dailyLoss))} / $250</span></div>
              <div className="h-1.5 bg-[oklch(0.11_0.005_260)] rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-[oklch(0.8_0.15_85)] to-destructive rounded-full transition-all duration-700" style={{ width: `${Math.min((Math.abs(dailyLoss) / 250) * 100, 100)}%` }} /></div>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="rounded-xl px-3 py-2 fade-in-up" style={{ animationDelay: '800ms', background: 'oklch(0.11 0.004 260 / 50%)' }}>
          <div className="flex items-center justify-center gap-2.5 text-[9px] text-muted-foreground/30">
            <span className="flex items-center gap-1">{isRunning ? <span className="w-1.5 h-1.5 rounded-full bg-primary pulse-live" /> : <WifiOff className="h-2.5 w-2.5" />} {isRunning ? "Conectado" : "Desconectado"}</span>
            <span className="text-border/15">|</span>
            <span className="tabular-nums">v10.1 LINEAR</span>
            <span className="text-border/15">|</span>
            <span className="tabular-nums">{currentTime.toLocaleTimeString()}</span>
          </div>
        </div>
      </div>
    </>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // ─── DESKTOP LAYOUT ───
  // ════════════════════════════════════════════════════════════════
  return (
    <>{depositDialog}
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between fade-in-up">
        <div>
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-extrabold tracking-tight">Panel</h1>
            <div className="flex gap-0.5 bg-[oklch(0.13_0.005_260)] rounded-xl p-0.5 border border-border/20">
              {["bybit", "kucoin", "both"].map(ex => (
                <button key={ex} onClick={() => handleExchangeChange(ex)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${selectedExchange === ex ? "bg-primary/20 text-primary shadow-sm" : "text-muted-foreground/60 hover:text-foreground"}`}>{exchangeLabel(ex)}</button>
              ))}
            </div>
            <Badge className="text-[9px] bg-[oklch(0.8_0.15_85)]/10 text-[oklch(0.8_0.15_85)] border border-[oklch(0.8_0.15_85)]/20 gap-1">
              <Crown className="h-3 w-3" /> v10.1 LINEAR
            </Badge>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <Badge variant={isRunning ? "default" : "secondary"} className={`${isRunning ? "bg-primary/15 text-primary border border-primary/30" : "border border-border/50"}`}>
              {isRunning ? <><span className="w-1.5 h-1.5 rounded-full bg-primary pulse-live mr-1.5 inline-block" /> EN VIVO</> : <><WifiOff className="h-3 w-3 mr-1" /> DESCONECTADO</>}
            </Badge>
            {state?.simulationMode && <Badge variant="outline" className="border-[oklch(0.8_0.15_85)] text-[oklch(0.8_0.15_85)]">SIMULACION</Badge>}
            {uptime && <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{uptime}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { const d = new Date().toISOString().slice(0,10); window.open(`/api/report/daily?date=${d}`, '_blank'); }} className="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-accent/50 transition-all" title="Descargar reporte PDF"><FileDown className="h-4 w-4 text-muted-foreground" /></button>
          <button onClick={() => setHideBalances(!hideBalances)} className="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-accent/50 transition-all">{hideBalances ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}</button>
          <button onClick={handleRefresh} className="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-accent/50 transition-all"><RefreshCw className={`h-4 w-4 text-muted-foreground ${isRefreshing ? "animate-spin" : ""}`} /></button>
          {notifPopover}
          {!isRunning ? (
            <Button onClick={() => startBot.mutate()} className="gap-2 font-bold shadow-lg shadow-primary/15" disabled={startBot.isPending}><Play className="h-4 w-4" /> Iniciar</Button>
          ) : (
            <><Button onClick={() => stopBot.mutate()} variant="secondary" className="gap-2 font-semibold" disabled={stopBot.isPending}><Square className="h-4 w-4" /> Detener</Button>
            <Button onClick={() => emergencyStop.mutate()} variant="destructive" className="gap-2 font-semibold" disabled={emergencyStop.isPending}><AlertTriangle className="h-4 w-4" /> Emergencia</Button></>
          )}
        </div>
      </div>

      {/* XAU Featured Ticker + Other Prices */}
      <div className="grid grid-cols-4 gap-3 fade-in-up" style={{ animationDelay: '100ms' }}>
        {tickerPairs.map(({ symbol, label, icon, color, isGold }) => {
          const p = (livePrices as any)[symbol]; const price = p?.lastPrice ?? 0; const change = p?.price24hPcnt ? p.price24hPcnt * 100 : 0; const isUp = change >= 0;
          return (
            <div key={symbol} className={`glass-card p-4 flex items-center justify-between interactive-card ${isGold ? 'xau-glow' : ''}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black ${isGold ? 'float-particle' : ''}`} style={{ background: `color-mix(in oklch, ${color} 15%, transparent)`, color }}>{icon}</div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground/60 font-medium">{label}</span>
                    {isGold && <Crown className="h-3 w-3 text-[oklch(0.8_0.15_85)]" />}
                  </div>
                  <span className="text-sm font-bold tabular-nums">{price > 0 ? "$" + fmtPrice(price) : "--"}</span>
                </div>
              </div>
              {price > 0 && <span className={`text-[10px] font-bold px-2 py-1 rounded-lg ${isUp ? "text-[oklch(0.72_0.19_160)] bg-[oklch(0.72_0.19_160)]/8" : "text-[oklch(0.63_0.24_25)] bg-[oklch(0.63_0.24_25)]/8"}`}>{isUp ? "+" : ""}{change.toFixed(2)}%</span>}
            </div>
          );
        })}
      </div>

      {/* Balance + Stats + USDT/AI */}
      <div className="grid grid-cols-3 gap-4 fade-in-up" style={{ animationDelay: '200ms' }}>
        <div className="col-span-2 relative overflow-hidden rounded-2xl" style={{ background: 'linear-gradient(145deg, oklch(0.16 0.03 160) 0%, oklch(0.13 0.015 200) 50%, oklch(0.12 0.008 260) 100%)', border: '1px solid oklch(0.72 0.19 160 / 10%)' }}>
          <div className="absolute top-0 right-0 w-56 h-56 bg-primary/5 rounded-full blur-[80px] -translate-y-16 translate-x-16" />
          <div className="relative p-7">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2"><p className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground/60 uppercase">Balance Total</p><span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg ${realProfitPct >= 0 ? 'bg-primary/15 text-primary border border-primary/20' : 'bg-destructive/15 text-destructive border border-destructive/20'}`}>{fmtPct(realProfitPct)}</span></div>
                <p className="text-5xl font-black tracking-tight tabular-nums leading-none count-up">{hideBalances ? "--------" : fmtUsd(totalBalance)}</p>
                <div className="flex items-center gap-2 mt-1.5"><p className="text-xs text-muted-foreground/40 tabular-nums">Invertido: {hideBalances ? "---" : fmtUsd(initialDeposit)}</p><button onClick={() => { setEditDepositValue(initialDeposit.toFixed(2)); setEditDepositOpen(true); }} className="text-muted-foreground/30 hover:text-primary transition-colors"><Pencil className="h-3 w-3" /></button></div>
              </div>
              {/* Daily Target Ring */}
              <div className="ml-4 flex flex-col items-center">
                <DailyTargetRing current={todayPnl} target={DAILY_TARGET} size={100} />
                <span className="text-[9px] text-muted-foreground/40 mt-1 tabular-nums font-medium">Meta: ${DAILY_TARGET}/dia</span>
              </div>
            </div>
            <div className="mt-5 pt-4 border-t border-white/[0.05]">
              <div className="flex items-center justify-between mb-4"><span className="text-[10px] font-bold tracking-[0.15em] text-muted-foreground/50 uppercase">Ganancia Hoy</span><span className={`text-xl font-black tabular-nums ${todayColor}`}>{hideBalances ? "----" : fmt(todayPnl)}</span></div>
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-white/[0.03] rounded-xl p-2.5 text-center"><span className="text-[9px] text-muted-foreground/50 block font-medium">Hoy</span><span className={`text-sm font-bold tabular-nums ${todayColor}`}>{hideBalances ? "--" : fmt(todayPnl)}</span></div>
                <div className="bg-white/[0.03] rounded-xl p-2.5 text-center"><span className="text-[9px] text-muted-foreground/50 block font-medium">Ayer</span><span className={`text-sm font-bold tabular-nums ${yesterdayColor}`}>{hideBalances ? "--" : fmt(yesterdayPnl)}</span></div>
                <div className="bg-white/[0.03] rounded-xl p-2.5 text-center"><span className="text-[9px] text-muted-foreground/50 block font-medium">Semana</span><span className={`text-sm font-bold tabular-nums ${weekColor}`}>{hideBalances ? "--" : fmt(weekPnl)}</span></div>
                <div className="bg-white/[0.03] rounded-xl p-2.5 text-center"><span className="text-[9px] text-muted-foreground/50 block font-medium">Año</span><span className={`text-sm font-bold tabular-nums ${yearColor}`}>{hideBalances ? "--" : fmt(yearPnl)}</span></div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="bg-white/[0.03] rounded-xl p-2.5 text-center"><span className="text-[9px] text-muted-foreground/50 block font-medium">Abierto ({openPosCount})</span><span className={`text-sm font-bold tabular-nums ${unrealizedPnl >= 0 ? 'text-[oklch(0.75_0.14_200)]' : 'text-[oklch(0.8_0.15_85)]'}`}>{hideBalances ? "--" : fmt(unrealizedPnl)}</span></div>
                <div className="bg-white/[0.03] rounded-xl p-2.5 text-center"><span className="text-[9px] text-muted-foreground/50 block font-medium">Futuros PnL</span><span className={`text-sm font-bold tabular-nums ${bybitUnrealized >= 0 ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.63_0.24_25)]'}`}>{hideBalances ? "--" : fmt(bybitUnrealized)}</span></div>
                <div className="bg-white/[0.03] rounded-xl p-2.5 text-center"><span className="text-[9px] text-muted-foreground/50 block font-medium">Trades Hoy</span><span className="text-sm font-bold tabular-nums text-primary">{todayTrades}</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Exchanges + USDT + AI */}
        <div className="space-y-3">
          <div className="glass-card p-3.5 interactive-card">
            <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'color-mix(in oklch, oklch(0.8 0.18 80) 10%, transparent)' }}><Wallet className="h-4 w-4" style={{ color: 'oklch(0.8 0.18 80)' }} /></div><div className="flex-1"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground/50">Bybit</span><span className="text-sm font-bold tabular-nums">{hideBalances ? "----" : fmtUsd(bybitBal)}</span></div><div className="flex items-center justify-between mt-0.5"><span className="text-[9px] text-muted-foreground/30">Libre</span><span className="text-[10px] text-muted-foreground/40 tabular-nums">{hideBalances ? "--" : fmtUsd(bybitAvail)}</span></div></div></div>
          </div>
          <div className="glass-card p-3.5 interactive-card">
            <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'color-mix(in oklch, oklch(0.75 0.14 170) 10%, transparent)' }}><Wallet className="h-4 w-4" style={{ color: 'oklch(0.75 0.14 170)' }} /></div><div className="flex-1"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground/50">KuCoin</span><span className="text-sm font-bold tabular-nums">{hideBalances ? "----" : fmtUsd(kucoinBal)}</span></div><div className="flex items-center justify-between mt-0.5"><span className="text-[9px] text-muted-foreground/30">Libre</span><span className="text-[10px] text-muted-foreground/40 tabular-nums">{hideBalances ? "--" : fmtUsd(kucoinAvail)}</span></div></div></div>
          </div>
          <div className={`glass-card p-3.5 interactive-card border ${usdtHealthy ? 'border-[oklch(0.72_0.19_160)]/10' : 'border-[oklch(0.8_0.15_85)]/15'}`}>
            <div className="flex items-center gap-3"><div className={`w-9 h-9 rounded-xl flex items-center justify-center ${usdtHealthy ? 'bg-[oklch(0.72_0.19_160)]/10' : 'bg-[oklch(0.8_0.15_85)]/10'}`}><CircleDollarSign className={`h-4 w-4 ${usdtHealthy ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.8_0.15_85)]'}`} /></div><div className="flex-1"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground/50">USDT Libre</span><span className="text-sm font-bold tabular-nums">{hideBalances ? "----" : fmtUsd(totalUsdt)}</span></div><div className="flex items-center gap-1.5 mt-1"><div className="flex-1 h-1.5 bg-[oklch(0.11_0.005_260)] rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-700 ${usdtHealthy ? 'bg-[oklch(0.72_0.19_160)]' : 'bg-[oklch(0.8_0.15_85)]'}`} style={{ width: `${Math.min(usdtPct, 100)}%` }} /></div><span className={`text-[9px] font-bold tabular-nums ${usdtHealthy ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.8_0.15_85)]'}`}>{usdtPct.toFixed(0)}%</span></div></div></div>
          </div>
          <button onClick={() => setShowAiModules(!showAiModules)} className="glass-card p-3.5 interactive-card w-full text-left border border-[oklch(0.65_0.2_300)]/10">
            <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl bg-[oklch(0.65_0.2_300)]/10 flex items-center justify-center"><Brain className="h-4 w-4 text-[oklch(0.65_0.2_300)]" /></div><div className="flex-1"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground/50">IA Activa</span><div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.72_0.19_160)] pulse-live" /><span className="text-[10px] text-[oklch(0.72_0.19_160)] font-bold">55+ modulos</span></div></div></div></div>
          </button>
        </div>
      </div>

      {/* AI Modules Expandable */}
      {showAiModules && (
        <div className="glass-card p-4 animate-in slide-in-from-top-2 duration-300">
          <div className="grid grid-cols-4 gap-2">
            {aiModules.map(m => (
              <div key={m.name} className="flex items-center gap-2 py-2 px-3 rounded-lg bg-[oklch(0.12_0.005_260)]">
                <m.icon className="h-3.5 w-3.5 text-primary/70 shrink-0" /><span className="text-[10px] font-medium text-muted-foreground/60 truncate">{m.name}</span><span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.72_0.19_160)] ml-auto shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Desktop Stats Row */}
      <div className="grid grid-cols-4 gap-3 fade-in-up" style={{ animationDelay: '300ms' }}>
        <div className="glass-card p-4 interactive-card text-center"><Trophy className="h-5 w-5 mx-auto mb-1.5 text-[oklch(0.8_0.15_85)]" /><p className="text-[10px] text-muted-foreground/40">Win Rate</p><p className="text-xl font-black tabular-nums">{winRate.toFixed(1)}%</p></div>
        <div className="glass-card p-4 interactive-card text-center"><Activity className="h-5 w-5 mx-auto mb-1.5 text-[oklch(0.65_0.2_300)]" /><p className="text-[10px] text-muted-foreground/40">Total Trades</p><p className="text-xl font-black tabular-nums">{totalTrades}</p></div>
        <div className="glass-card p-4 interactive-card text-center"><Zap className="h-5 w-5 mx-auto mb-1.5 text-primary" /><p className="text-[10px] text-muted-foreground/40">Hoy</p><p className="text-xl font-black tabular-nums">{todayTrades}</p></div>
        <div className="glass-card p-4 interactive-card text-center"><Flame className="h-5 w-5 mx-auto mb-1.5 text-[oklch(0.8_0.15_85)]" /><p className="text-[10px] text-muted-foreground/40">Posiciones</p><p className="text-xl font-black tabular-nums">{totalOpenPositions}</p></div>
      </div>

      {/* Advanced PnL + Strategy */}
      <div className="grid grid-cols-2 gap-4 fade-in-up" style={{ animationDelay: '400ms' }}>
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border/15 flex items-center justify-between"><div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /><h3 className="font-bold text-sm">Rendimiento</h3></div>{advancedStats.isFetching && <RefreshCw className="h-3 w-3 text-muted-foreground/30 animate-spin" />}</div>
          <div className="p-5 space-y-4">
            {periodPills}
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-3 rounded-xl bg-[oklch(0.72_0.19_160)]/5"><ArrowUp className="h-4 w-4 text-[oklch(0.72_0.19_160)] mx-auto mb-1" /><p className="text-[9px] text-muted-foreground/50">Ganancias</p><p className="text-sm font-bold tabular-nums text-[oklch(0.72_0.19_160)]">{hideBalances ? "--" : `+$${(as?.totalGains ?? 0).toFixed(2)}`}</p></div>
              <div className="text-center p-3 rounded-xl bg-[oklch(0.63_0.24_25)]/5"><ArrowDown className="h-4 w-4 text-[oklch(0.63_0.24_25)] mx-auto mb-1" /><p className="text-[9px] text-muted-foreground/50">Perdidas</p><p className="text-sm font-bold tabular-nums text-[oklch(0.63_0.24_25)]">{hideBalances ? "--" : `-$${(as?.totalLosses ?? 0).toFixed(2)}`}</p></div>
              <div className="text-center p-3 rounded-xl" style={{ background: (as?.netProfit ?? 0) >= 0 ? 'oklch(0.72 0.19 160 / 8%)' : 'oklch(0.63 0.24 25 / 8%)', border: `1px solid ${(as?.netProfit ?? 0) >= 0 ? 'oklch(0.72 0.19 160 / 12%)' : 'oklch(0.63 0.24 25 / 12%)'}` }}><DollarSign className={`h-4 w-4 mx-auto mb-1 ${(as?.netProfit ?? 0) >= 0 ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.63_0.24_25)]'}`} /><p className="text-[9px] text-muted-foreground/50">Neto Real</p><p className={`text-sm font-black tabular-nums ${(as?.netProfit ?? 0) >= 0 ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.63_0.24_25)]'}`}>{hideBalances ? "--" : fmt(as?.netProfit ?? 0)}</p></div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[{ label: "Trades", value: String(as?.totalTrades ?? 0) }, { label: "Win Rate", value: `${(as?.winRate ?? 0).toFixed(1)}%`, color: "oklch(0.72 0.19 160)" }, { label: "Ganados", value: String(as?.winTrades ?? 0), color: "oklch(0.72 0.19 160)" }, { label: "Perdidos", value: String(as?.loseTrades ?? 0), color: "oklch(0.63 0.24 25)" }].map(s => (
                <div key={s.label} className="text-center py-2 rounded-lg bg-[oklch(0.11_0.005_260)]"><p className="text-[9px] text-muted-foreground/40">{s.label}</p><p className="text-sm font-bold tabular-nums" style={s.color ? { color: s.color } : undefined}>{s.value}</p></div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[{ label: "Profit Factor", value: (as?.profitFactor ?? 0) > 100 ? "\u221e" : (as?.profitFactor ?? 0).toFixed(2), color: (as?.profitFactor ?? 0) >= 1.5 ? "oklch(0.72 0.19 160)" : "oklch(0.8 0.15 85)" }, { label: "Avg Win", value: hideBalances ? "--" : `+$${(as?.avgWin ?? 0).toFixed(2)}`, color: "oklch(0.72 0.19 160)" }, { label: "Avg Loss", value: hideBalances ? "--" : `-$${(as?.avgLoss ?? 0).toFixed(2)}`, color: "oklch(0.63 0.24 25)" }, { label: "Mejor Trade", value: hideBalances ? "--" : fmt(as?.bestTrade ?? 0), color: "oklch(0.72 0.19 160)" }, { label: "Peor Trade", value: hideBalances ? "--" : fmt(as?.worstTrade ?? 0), color: "oklch(0.63 0.24 25)" }, { label: "Prom. Diario", value: hideBalances ? "--" : fmt(as?.avgDaily ?? 0), color: (as?.avgDaily ?? 0) >= 0 ? "oklch(0.72 0.19 160)" : "oklch(0.63 0.24 25)" }].map(m => (
                <div key={m.label} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[oklch(0.11_0.005_260)]"><span className="text-[10px] text-muted-foreground/40">{m.label}</span><span className="text-[11px] font-bold tabular-nums" style={{ color: m.color }}>{m.value}</span></div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[oklch(0.11_0.005_260)]"><span className="text-[10px] text-muted-foreground/40">Mejor Dia</span><span className="text-[11px] font-bold tabular-nums text-[oklch(0.72_0.19_160)]">{hideBalances ? "--" : fmt(as?.bestDay ?? 0)}</span></div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[oklch(0.11_0.005_260)]"><span className="text-[10px] text-muted-foreground/40">Peor Dia</span><span className="text-[11px] font-bold tabular-nums text-[oklch(0.63_0.24_25)]">{hideBalances ? "--" : fmt(as?.worstDay ?? 0)}</span></div>
            </div>
          </div>
        </div>

        {/* Strategy + Top Symbols */}
        <div className="space-y-4">
          {Object.keys(stratBreakdown).length > 0 && (
            <div className="glass-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border/15 flex items-center gap-2"><Layers className="h-4 w-4 text-[oklch(0.65_0.2_300)]" /><h3 className="font-bold text-sm">PnL por Estrategia</h3></div>
              <div className="p-5">
                {pieData.length > 0 && <div className="flex items-center gap-4 mb-3"><div className="w-24 h-24 shrink-0"><ResponsiveContainer width="100%" height="100%"><RPieChart><Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={28} outerRadius={44} paddingAngle={3} strokeWidth={0}>{pieData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}</Pie></RPieChart></ResponsiveContainer></div><div className="flex-1 space-y-2">{pieData.map(d => <div key={d.name} className="flex items-center justify-between"><div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} /><span className="text-xs font-medium text-muted-foreground/60">{d.name}</span></div><span className={`text-xs font-bold tabular-nums ${d.pnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>{hideBalances ? "--" : fmt(d.pnl)}</span></div>)}</div></div>}
                {Object.entries(stratBreakdown).map(([key, v]) => { const color = strategyColors[key] || strategyColors.unknown; const label = strategyLabels[key] || key; const wr = (v.wins + v.losses) > 0 ? ((v.wins / (v.wins + v.losses)) * 100).toFixed(0) : "--"; return <div key={key} className="flex items-center justify-between py-2.5 border-b border-border/8 last:border-0"><div className="flex items-center gap-2"><div className="w-1.5 h-8 rounded-full" style={{ background: color }} /><div><span className="text-sm font-bold">{label}</span><div className="flex gap-2 mt-0.5"><span className="text-[9px] text-muted-foreground/40">{v.trades} ops</span><span className="text-[9px] text-muted-foreground/40">{wr}% WR</span></div></div></div><div className="text-right"><span className={`text-sm font-bold tabular-nums ${v.pnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>{hideBalances ? "--" : fmt(v.pnl)}</span><div className="flex gap-1 justify-end mt-0.5"><span className="text-[9px] text-[oklch(0.72_0.19_160)]">{v.wins}W</span><span className="text-[9px] text-muted-foreground/20">/</span><span className="text-[9px] text-[oklch(0.63_0.24_25)]">{v.losses}L</span></div></div></div>; })}
              </div>
            </div>
          )}
          {topSymbols.length > 0 && (
            <div className="glass-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border/15 flex items-center gap-2"><Award className="h-4 w-4 text-[oklch(0.8_0.15_85)]" /><h3 className="font-bold text-sm">Top Pares ({periodLabels[selectedPeriod]})</h3></div>
              <div className="px-5 py-2">{topSymbols.slice(0, 6).map((s: any) => <div key={s.symbol} className="flex items-center justify-between py-2 border-b border-border/8 last:border-0"><div className="flex items-center gap-2"><span className={`text-sm font-bold ${s.symbol.includes('XAU') ? 'text-[oklch(0.8_0.15_85)]' : ''}`}>{s.symbol.replace("USDT", "")}</span>{s.symbol.includes('XAU') && <Crown className="h-3 w-3 text-[oklch(0.8_0.15_85)]" />}<span className="text-[9px] text-muted-foreground/30">{s.trades} ops</span></div><span className={`text-sm font-bold tabular-nums ${s.pnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>{hideBalances ? "--" : fmt(s.pnl)}</span></div>)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-2 gap-4 fade-in-up" style={{ animationDelay: '500ms' }}>
        {pnlChartData.length > 0 ? (
          <div className="glass-card p-5"><div className="flex items-center gap-2 mb-3"><TrendingUp className="h-4 w-4 text-primary" /><h3 className="font-bold text-sm">Curva PnL ({periodLabels[selectedPeriod]})</h3></div>
            <ResponsiveContainer width="100%" height={180}><AreaChart data={pnlChartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}><defs><linearGradient id="pnlGD" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0.3} /><stop offset="95%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" /><XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.2)' }} tickFormatter={(v) => v?.slice(5)} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.2)' }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: 'oklch(0.14 0.005 260)', border: '1px solid oklch(1 0 0 / 10%)', borderRadius: 12, fontSize: 11 }} formatter={(v: any) => [fmt(parseFloat(v)), 'PnL']} /><Area type="monotone" dataKey="pnl" stroke="oklch(0.72 0.19 160)" fill="url(#pnlGD)" strokeWidth={2} dot={false} /></AreaChart></ResponsiveContainer>
          </div>
        ) : <div className="glass-card p-5 flex items-center justify-center"><div className="text-center text-muted-foreground/30"><BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-20" /><p className="text-xs">Sin datos PnL</p></div></div>}
        {barData.length > 0 ? (
          <div className="glass-card p-5"><div className="flex items-center gap-2 mb-3"><BarChart3 className="h-4 w-4 text-primary" /><h3 className="font-bold text-sm">PnL por Par</h3></div>
            <ResponsiveContainer width="100%" height={180}><BarChart data={barData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" /><XAxis dataKey="pair" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} axisLine={false} /><YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} axisLine={false} /><Tooltip contentStyle={{ background: 'oklch(0.14 0.005 260)', border: '1px solid oklch(1 0 0 / 10%)', borderRadius: 12, fontSize: 11 }} formatter={(v: any) => [fmt(parseFloat(v)), 'PnL']} /><Bar dataKey="pnl" radius={[6, 6, 0, 0]}>{barData.map((entry: any, idx: number) => <Cell key={idx} fill={entry.pnl >= 0 ? "oklch(0.72 0.19 160)" : "oklch(0.63 0.24 25)"} />)}</Bar></BarChart></ResponsiveContainer>
          </div>
        ) : (
          <div className="glass-card p-5"><div className="flex items-center gap-2 mb-4"><Zap className="h-4 w-4 text-primary" /><h3 className="font-bold text-sm">Ultimas Operaciones</h3></div>
            <div className="space-y-1 max-h-[200px] overflow-y-auto">{(!tradesQuery.data || tradesQuery.data.length === 0) ? <div className="flex flex-col items-center justify-center h-32 text-muted-foreground"><Activity className="h-8 w-8 opacity-10 mb-2" /><span className="text-sm">Sin operaciones</span></div> : tradesQuery.data.slice(0, 8).map((t: any) => { const pnl = parseFloat(String(t.pnl ?? "0")); return <div key={t.id} className="flex items-center justify-between py-2 border-b border-border/10 last:border-0 px-1"><div className="flex items-center gap-2"><Badge variant={t.side === "buy" ? "default" : "destructive"} className="text-[9px] w-10 justify-center shrink-0 font-bold">{t.side === "buy" ? "C" : "V"}</Badge><span className={`text-sm font-bold ${t.symbol?.includes('XAU') ? 'text-[oklch(0.8_0.15_85)]' : ''}`}>{t.symbol?.replace("USDT", "")}</span></div><span className={`text-xs font-bold tabular-nums ${pnl > 0 ? "text-[oklch(0.72_0.19_160)]" : pnl < 0 ? "text-[oklch(0.63_0.24_25)]" : "text-muted-foreground/30"}`}>{hideBalances ? "--" : fmt(pnl)}</span></div>; })}</div>
          </div>
        )}
      </div>

      {/* Risk + Open Positions */}
      <div className="grid grid-cols-2 gap-4 fade-in-up" style={{ animationDelay: '600ms' }}>
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2"><Shield className="h-4 w-4 text-[oklch(0.8_0.15_85)]" /><h3 className="font-bold text-sm">Gestion de Riesgo</h3></div><Badge variant="outline" className={`text-[10px] font-bold ${dailyLoss > 200 ? "border-destructive/40 text-destructive bg-destructive/5" : "border-primary/20 text-primary bg-primary/5"}`}>{dailyLoss > 200 ? "ALTO" : "OK"}</Badge></div>
          <div className="space-y-5">
            <div><div className="flex justify-between text-xs mb-2"><span className="text-muted-foreground/50">Max Drawdown</span><span className="tabular-nums font-bold">{hideBalances ? "--" : `${(maxDrawdown * 100).toFixed(2)}%`} / 10%</span></div><div className="h-2 bg-[oklch(0.11_0.005_260)] rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-primary to-[oklch(0.75_0.14_200)] rounded-full transition-all duration-700" style={{ width: `${Math.min((maxDrawdown * 100) / 10 * 100, 100)}%` }} /></div></div>
            <div><div className="flex justify-between text-xs mb-2"><span className="text-muted-foreground/50">Perdida Diaria</span><span className="tabular-nums font-bold">{hideBalances ? "--" : fmtUsd(Math.abs(dailyLoss))} / $250</span></div><div className="h-2 bg-[oklch(0.11_0.005_260)] rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-[oklch(0.8_0.15_85)] to-destructive rounded-full transition-all duration-700" style={{ width: `${Math.min((Math.abs(dailyLoss) / 250) * 100, 100)}%` }} /></div></div>
          </div>
        </div>
        <div className="glass-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border/15"><div className="flex items-center gap-2"><Flame className="h-4 w-4 text-[oklch(0.8_0.15_85)]" /><h3 className="font-bold text-sm">Posiciones Abiertas</h3></div><Badge variant="outline" className="text-[10px] font-bold border-border/30">{totalOpenPositions}</Badge></div>
          <div className="divide-y divide-border/8 max-h-[200px] overflow-y-auto">
            {totalOpenPositions === 0 ? <div className="flex flex-col items-center justify-center py-10 text-muted-foreground"><Target className="h-8 w-8 opacity-10 mb-2" /><span className="text-sm">Sin posiciones</span></div> : [...openPositions.grid, ...openPositions.futures].map((p: any, i: number) => <div key={i} className="flex items-center justify-between px-5 py-3 hover:bg-accent/10 transition-colors"><div className="flex items-center gap-2.5"><span className={`text-sm font-bold ${p.symbol?.includes('XAU') ? 'text-[oklch(0.8_0.15_85)]' : ''}`}>{p.symbol?.replace('USDT', '')}</span>{p.symbol?.includes('XAU') && <Crown className="h-3 w-3 text-[oklch(0.8_0.15_85)]" />}<span className="text-[10px] text-muted-foreground/40 tabular-nums">@ ${fmtPrice(p.buyPrice)}</span></div><span className={`text-sm font-bold tabular-nums ${p.unrealizedPnl >= 0 ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.63_0.24_25)]'}`}>{hideBalances ? "--" : fmt(p.unrealizedPnl)}</span></div>)}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="rounded-xl px-4 py-2.5 fade-in-up" style={{ animationDelay: '700ms', background: 'oklch(0.11 0.004 260 / 50%)' }}>
        <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground/30">
          <span className="flex items-center gap-1.5">{isRunning ? <span className="w-1.5 h-1.5 rounded-full bg-primary pulse-live" /> : <WifiOff className="h-3 w-3" />} {isRunning ? "Conectado" : "Desconectado"}</span>
          <span className="text-border/15">|</span><span className="tabular-nums">v10.1 LINEAR</span>
          <span className="text-border/15">|</span><span className="tabular-nums">Ciclos: {data?.cycles ?? 0}</span>
          <span className="text-border/15">|</span><span className="tabular-nums">{currentTime.toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  </>
  );
}
