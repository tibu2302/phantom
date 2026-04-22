import { trpc } from "@/lib/trpc";
import {
  Bell, Play, Square, AlertTriangle, TrendingUp, TrendingDown,
  Wallet, Target, Trophy, Activity, BarChart3, Shield, Wifi, WifiOff,
  Clock, Zap, ArrowUpRight, ArrowDownRight, RefreshCw, Eye, EyeOff,
  ChevronRight, Flame, Pencil
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useIsMobile } from "@/hooks/useMobile";

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

export default function Home() {
  const isMobile = useIsMobile();
  const { data, isLoading, refetch: refetchStatus } = trpc.bot.status.useQuery(undefined, { refetchInterval: 5000, retry: false });
  const publicPrices = trpc.prices.live.useQuery(undefined, { refetchInterval: 8000 });
  const strategiesQuery = trpc.strategies.list.useQuery(undefined, { retry: false });
  const tradesQuery = trpc.trades.list.useQuery({ limit: 50 }, { retry: false });
  const pnlHistory = trpc.pnl.history.useQuery({ days: 14 }, { retry: false, staleTime: 60_000 });
  const exchangeBalances = trpc.bot.exchangeBalances.useQuery(undefined, { refetchInterval: 30_000, retry: false });
  const utils = trpc.useUtils();

  const startBot = trpc.bot.start.useMutation({
    onSuccess: (res: any) => {
      utils.bot.status.invalidate();
      if (res.success) toast.success("Motor PHANTOM iniciado");
      else toast.error(res.error || "Error al iniciar");
    },
    onError: () => toast.error("Error al iniciar el motor"),
  });
  const stopBot = trpc.bot.stop.useMutation({
    onSuccess: () => { utils.bot.status.invalidate(); toast.success("Motor detenido"); }
  });
  const emergencyStop = trpc.bot.emergencyStop.useMutation({
    onSuccess: () => { utils.bot.status.invalidate(); toast.error("PARADA DE EMERGENCIA ejecutada"); }
  });
  const markRead = trpc.bot.markNotificationsRead.useMutation({
    onSuccess: () => utils.bot.status.invalidate()
  });

  const [bellOpen, setBellOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hideBalances, setHideBalances] = useState(false);
  const [editDepositOpen, setEditDepositOpen] = useState(false);
  const [editDepositValue, setEditDepositValue] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleRefresh = useCallback(async () => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(30);
    setIsRefreshing(true);
    await Promise.all([
      utils.bot.status.invalidate(),
      utils.prices.live.invalidate(),
    ]);
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

  // ── REAL exchange data from API ──
  const eb = exchangeBalances.data;
  const bybitBal = parseFloat(eb?.bybit?.balance ?? "0");
  const bybitAvail = parseFloat(eb?.bybit?.available ?? "0");
  const bybitUnrealized = parseFloat(eb?.bybit?.unrealizedPnl ?? "0");
  const bybitProfit = parseFloat((eb?.bybit as any)?.profit ?? "0");
  const kucoinBal = parseFloat(eb?.kucoin?.balance ?? "0");
  const kucoinAvail = parseFloat(eb?.kucoin?.available ?? "0");
  const kucoinProfit = parseFloat((eb?.kucoin as any)?.profit ?? "0");
  const totalBalance = parseFloat(eb?.totalBalance ?? "0");
  const initialDeposit = parseFloat(eb?.initialDeposit ?? "2500");
  const realProfit = parseFloat(eb?.realProfit ?? "0");
  const realProfitPct = parseFloat(eb?.realProfitPct ?? "0");
  const todayPnl = parseFloat(eb?.todayPnl ?? "0");
  const todayTrades = eb?.todayTrades ?? 0;
  const totalTrades = eb?.totalTrades ?? 0;
  const winRate = parseFloat(eb?.winRate ?? "0");
  const unrealizedPnl = parseFloat(eb?.openPositions?.unrealizedPnl ?? "0");
  const openPosCount = eb?.openPositions?.count ?? totalOpenPositions;

  const updateSettings = trpc.bot.updateSettings.useMutation({
    onSuccess: () => { utils.bot.status.invalidate(); utils.bot.exchangeBalances.invalidate(); },
  });
  const handleSaveDeposit = () => {
    const val = parseFloat(editDepositValue);
    if (isNaN(val) || val < 0) { toast.error("Ingresá un monto válido"); return; }
    updateSettings.mutate({ initialBalance: val.toFixed(2) });
    setEditDepositOpen(false);
    toast.success(`Capital invertido actualizado: ${fmtUsd(val)}`);
  };
  const exchangeLabel = (ex: string) => ex === "kucoin" ? "KuCoin" : ex === "bybit" ? "Bybit" : "Ambos";
  const handleExchangeChange = (exchange: string) => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(15);
    if (isRunning) { toast.error("Detené el bot antes de cambiar de exchange"); return; }
    updateSettings.mutate({ selectedExchange: exchange });
    toast.success(`Exchange: ${exchangeLabel(exchange)}`);
  };

  const livePrices = (data?.livePrices && Object.keys(data.livePrices).length > 0)
    ? data.livePrices
    : (publicPrices.data ?? {});

  const uptime = useMemo(() => {
    if (!state?.startedAt || !isRunning) return null;
    const diff = Date.now() - new Date(state.startedAt).getTime();
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }, [state?.startedAt, isRunning, currentTime]);

  const pnlColor = realProfit >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]";
  const todayColor = todayPnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]";

  const strategies = strategiesQuery.data ?? [];
  const barData = strategies.length > 0
    ? strategies.map((s: any) => ({
        pair: s.symbol.replace("USDT", ""),
        pnl: parseFloat(String(s.pnl ?? "0")),
      }))
    : [{ pair: "BTC", pnl: 0 }, { pair: "ETH", pnl: 0 }, { pair: "XAU", pnl: 0 }];

  const tickerPairs = [
    { symbol: "BTCUSDT", label: "BTC", icon: "₿", color: "oklch(0.8 0.15 85)" },
    { symbol: "ETHUSDT", label: "ETH", icon: "Ξ", color: "oklch(0.75 0.14 200)" },
    { symbol: "XAUUSDT", label: "Oro", icon: "Au", color: "oklch(0.8 0.15 85)" },
    { symbol: "SP500", label: "S&P", icon: "SP", color: "oklch(0.65 0.2 300)" },
  ];

  if (isLoading && publicPrices.isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-14 glass-card rounded-2xl" />
        <div className="h-44 glass-card rounded-2xl" />
        <div className="grid grid-cols-2 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 glass-card rounded-2xl" />)}</div>
      </div>
    );
  }

  const depositDialog = (
    <Dialog open={editDepositOpen} onOpenChange={setEditDepositOpen}>
      <DialogContent className="sm:max-w-[340px]" style={{ background: 'oklch(0.14 0.005 260)', border: '1px solid oklch(1 0 0 / 10%)' }}>
        <DialogHeader>
          <DialogTitle className="text-foreground">Capital Invertido</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-xs text-muted-foreground">Ingresá el monto total que depositaste en los exchanges (Bybit + KuCoin).</p>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-bold">$</span>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={editDepositValue}
              onChange={(e) => setEditDepositValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveDeposit()}
              className="text-lg font-bold tabular-nums"
              placeholder="2500.00"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setEditDepositOpen(false)}>Cancelar</Button>
            <Button className="flex-1" onClick={handleSaveDeposit}>Guardar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (isMobile) {
    return (
      <>{depositDialog}
      <div className="space-y-4 pb-2">
        {/* ── Header: Exchange + Status + Actions ── */}
        <div className="flex items-center justify-between">
          {/* Exchange Pills */}
          <div className="flex gap-1 bg-[oklch(0.15_0.005_260)] rounded-xl p-1 border border-border/30">
            {["bybit", "kucoin", "both"].map(ex => (
              <button
                key={ex}
                onClick={() => handleExchangeChange(ex)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wide transition-all duration-300 ${
                  selectedExchange === ex
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                }`}
              >
                {exchangeLabel(ex)}
              </button>
            ))}
          </div>
          {/* Right Actions */}
          <div className="flex items-center gap-0.5">
            <button onClick={() => setHideBalances(!hideBalances)} className="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-accent/50 transition-all active:scale-95">
              {hideBalances ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
            </button>
            <button onClick={handleRefresh} className="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-accent/50 transition-all active:scale-95">
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
            <Popover open={bellOpen} onOpenChange={(open) => { setBellOpen(open); if (open && unread > 0) markRead.mutate(); }}>
              <PopoverTrigger asChild>
                <button className="relative h-9 w-9 flex items-center justify-center rounded-xl hover:bg-accent/50 transition-all active:scale-95">
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  {unread > 0 && (
                    <span className="absolute top-0.5 right-0.5 h-4 min-w-4 px-1 rounded-full bg-destructive text-[9px] font-bold flex items-center justify-center text-white animate-pulse">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0 glass-card-elevated" align="end">
                <div className="p-3 border-b border-border/30"><h4 className="font-semibold text-sm">Notificaciones</h4></div>
                <div className="max-h-64 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-4 text-center">Sin notificaciones</p>
                  ) : notifications.map((n: any) => (
                    <div key={n.id} className="p-3 border-b border-border/20 last:border-0 hover:bg-accent/20 transition-colors">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{n.symbol}</span>
                        <Badge variant={String(n.signal).includes("BUY") ? "default" : "destructive"} className="text-[10px]">
                          {String(n.signal).includes("BUY") ? "COMPRA" : "VENTA"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Confianza: {n.confidence}%</p>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* ── Status + Bot Controls ── */}
        <div className="flex items-center gap-2">
          <Badge
            variant={isRunning ? "default" : "secondary"}
            className={`text-[10px] px-2.5 py-1 ${isRunning ? "bg-primary/15 text-primary border border-primary/30" : "border border-border/50"}`}
          >
            {isRunning
              ? <><span className="w-1.5 h-1.5 rounded-full bg-primary pulse-live mr-1.5 inline-block" />EN VIVO</>
              : <><WifiOff className="h-3 w-3 mr-1" />OFFLINE</>
            }
          </Badge>
          {state?.simulationMode && (
            <Badge variant="outline" className="text-[10px] border-[oklch(0.8_0.15_85)]/50 text-[oklch(0.8_0.15_85)]">SIM</Badge>
          )}
          {uptime && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />{uptime}
            </span>
          )}
          <div className="flex-1" />
          {!isRunning ? (
            <Button
              onClick={() => startBot.mutate()}
              size="sm"
              className="h-9 px-5 text-xs font-bold gap-1.5 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-95"
              disabled={startBot.isPending}
            >
              <Play className="h-3.5 w-3.5" />
              {startBot.isPending ? "..." : "Iniciar"}
            </Button>
          ) : (
            <div className="flex gap-1.5">
              <Button onClick={() => stopBot.mutate()} variant="secondary" size="sm" className="h-9 px-3 text-xs font-semibold active:scale-95" disabled={stopBot.isPending}>
                <Square className="h-3.5 w-3.5" />
              </Button>
              <Button onClick={() => emergencyStop.mutate()} variant="destructive" size="sm" className="h-9 px-3 text-xs font-semibold active:scale-95" disabled={emergencyStop.isPending}>
                <AlertTriangle className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        {/* ── Price Ticker Strip ── */}
        <div className="overflow-x-auto -mx-4 px-4 scrollbar-none">
          <div className="flex gap-2" style={{ width: "max-content" }}>
            {tickerPairs.map(({ symbol, label, icon, color }) => {
              const p = (livePrices as any)[symbol];
              const price = p?.lastPrice ?? 0;
              const change = p?.price24hPcnt ? p.price24hPcnt * 100 : 0;
              const isUp = change >= 0;
              return (
                <div key={symbol} className="flex items-center gap-2.5 glass-card px-3 py-2.5 interactive-card">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-black" style={{ background: `color-mix(in oklch, ${color} 12%, transparent)`, color }}>
                    {icon}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground/70 font-medium">{label}</span>
                    <span className="text-[13px] font-bold tabular-nums">{price > 0 ? "$" + fmtPrice(price) : "—"}</span>
                  </div>
                  {price > 0 && (
                    <span className={`text-[10px] font-bold ml-0.5 px-1.5 py-0.5 rounded-md ${isUp ? "text-[oklch(0.72_0.19_160)] bg-[oklch(0.72_0.19_160)]/8" : "text-[oklch(0.63_0.24_25)] bg-[oklch(0.63_0.24_25)]/8"}`}>
                      {isUp ? "+" : ""}{change.toFixed(1)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Balance Total Hero Card ── */}
        <div className="relative overflow-hidden rounded-2xl shimmer-bg" style={{ background: 'linear-gradient(145deg, oklch(0.17 0.025 160) 0%, oklch(0.14 0.012 180) 40%, oklch(0.13 0.006 240) 100%)', border: '1px solid oklch(0.72 0.19 160 / 12%)' }}>
          <div className="absolute top-0 right-0 w-48 h-48 bg-primary/6 rounded-full blur-[80px] -translate-y-12 translate-x-12" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-[oklch(0.75_0.14_200)]/4 rounded-full blur-[50px] translate-y-8 -translate-x-8" />
          <div className="relative p-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground/70 uppercase">Balance Total</span>
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg backdrop-blur-sm ${realProfitPct >= 0 ? 'bg-primary/15 text-primary border border-primary/20' : 'bg-destructive/15 text-destructive border border-destructive/20'}`}>
                {fmtPct(realProfitPct)}
              </span>
            </div>
            <p className="text-[42px] font-black tracking-tight tabular-nums leading-none text-foreground">
              {hideBalances ? "••••••" : fmtUsd(totalBalance)}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <p className="text-[10px] text-muted-foreground/50 tabular-nums">Invertido: {hideBalances ? "•••" : fmtUsd(initialDeposit)}</p>
              <button onClick={() => { setEditDepositValue(initialDeposit.toFixed(2)); setEditDepositOpen(true); }} className="text-muted-foreground/40 hover:text-primary transition-colors"><Pencil className="h-2.5 w-2.5" /></button>
            </div>

            {/* Ganancia Real */}
            <div className="mt-4 pt-3 border-t border-white/[0.06]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[9px] font-bold tracking-[0.15em] text-muted-foreground/60 uppercase">Ganancia Real</span>
                <span className={`text-lg font-black tabular-nums ${pnlColor}`}>
                  {hideBalances ? "••••" : fmt(realProfit)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className={`w-1.5 h-1.5 rounded-full mb-1 ${todayPnl >= 0 ? 'bg-[oklch(0.72_0.19_160)]' : 'bg-[oklch(0.63_0.24_25)]'} pulse-live`} />
                  <span className="text-[9px] text-muted-foreground/50 font-medium block">Hoy ({todayTrades})</span>
                  <span className={`text-[13px] font-bold tabular-nums ${todayColor}`}>{hideBalances ? "••" : fmt(todayPnl)}</span>
                </div>
                <div>
                  <div className={`w-1.5 h-1.5 rounded-full mb-1 ${unrealizedPnl >= 0 ? 'bg-[oklch(0.75_0.14_200)]' : 'bg-[oklch(0.8_0.15_85)]'}`} />
                  <span className="text-[9px] text-muted-foreground/50 font-medium block">Abierto ({openPosCount})</span>
                  <span className={`text-[13px] font-bold tabular-nums ${unrealizedPnl >= 0 ? 'text-[oklch(0.75_0.14_200)]' : 'text-[oklch(0.8_0.15_85)]'}`}>
                    {hideBalances ? "••" : fmt(unrealizedPnl)}
                  </span>
                </div>
                <div>
                  <div className="w-1.5 h-1.5 rounded-full mb-1 bg-[oklch(0.65_0.2_300)]" />
                  <span className="text-[9px] text-muted-foreground/50 font-medium block">Futuros</span>
                  <span className={`text-[13px] font-bold tabular-nums ${bybitUnrealized >= 0 ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.63_0.24_25)]'}`}>
                    {hideBalances ? "••" : fmt(bybitUnrealized)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Exchange Balances ── */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="glass-card p-4 interactive-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in oklch, oklch(0.8 0.18 80) 10%, transparent)' }}>
                <Wallet className="h-4 w-4" style={{ color: 'oklch(0.8 0.18 80)' }} />
              </div>
              <span className="text-[10px] font-bold tracking-wider text-muted-foreground/60 uppercase">Bybit</span>
            </div>
            <p className="text-[17px] font-black tabular-nums">{hideBalances ? "••••" : fmtUsd(bybitBal)}</p>
            <p className="text-[9px] text-muted-foreground/40 tabular-nums mt-0.5">Disponible: {hideBalances ? "••" : fmtUsd(bybitAvail)}</p>
          </div>
          <div className="glass-card p-4 interactive-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in oklch, oklch(0.75 0.14 170) 10%, transparent)' }}>
                <Wallet className="h-4 w-4" style={{ color: 'oklch(0.75 0.14 170)' }} />
              </div>
              <span className="text-[10px] font-bold tracking-wider text-muted-foreground/60 uppercase">KuCoin</span>
            </div>
            <p className="text-[17px] font-black tabular-nums">{hideBalances ? "••••" : fmtUsd(kucoinBal)}</p>
            <p className="text-[9px] text-muted-foreground/40 tabular-nums mt-0.5">Disponible: {hideBalances ? "••" : fmtUsd(kucoinAvail)}</p>
          </div>
        </div>

        {/* ── Stats Grid: Win Rate + Trades ── */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { icon: Trophy, label: "Win Rate", value: winRate.toFixed(1) + "%", sub: `${totalTrades} trades`, color: "oklch(0.8 0.15 85)", bg: "oklch(0.8 0.15 85)" },
            { icon: Activity, label: "Total Trades", value: String(totalTrades), sub: `${todayTrades} hoy`, color: "oklch(0.65 0.2 300)", bg: "oklch(0.65 0.2 300)" },
          ].map((s) => (
            <div key={s.label} className="glass-card p-4 flex items-center gap-3 interactive-card">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `color-mix(in oklch, ${s.bg} 10%, transparent)` }}>
                <s.icon className="h-4.5 w-4.5" style={{ color: s.color }} />
              </div>
              <div>
                <p className="text-[9px] font-semibold tracking-wider text-muted-foreground/60 uppercase">{s.label}</p>
                <p className="text-[15px] font-bold tabular-nums mt-0.5">{s.value}</p>
                <p className="text-[9px] text-muted-foreground/40">{s.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Open Positions (if any) ── */}
        {totalOpenPositions > 0 && (
          <div className="glass-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[oklch(0.8_0.15_85)]/10 flex items-center justify-center">
                  <Flame className="h-3.5 w-3.5 text-[oklch(0.8_0.15_85)]" />
                </div>
                <span className="text-xs font-bold">Posiciones Abiertas</span>
              </div>
              <Badge variant="outline" className="text-[9px] font-bold border-border/40">{totalOpenPositions}</Badge>
            </div>
            <div className="divide-y divide-border/10">
              {[...openPositions.grid, ...openPositions.futures].slice(0, 5).map((p: any, i: number) => (
                   <div key={i} className="flex items-center justify-between px-4 py-3 hover:bg-accent/10 transition-colors active:bg-accent/5">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-bold">{p.symbol?.replace('USDT', '')}</span>
                    <span className="text-[10px] text-muted-foreground/60 tabular-nums">@ ${fmtPrice(p.buyPrice)}</span>
                  </div>
                  <span className={`text-sm font-bold tabular-nums ${p.unrealizedPnl >= 0 ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.63_0.24_25)]'}`}>
                    {hideBalances ? "••" : fmt(p.unrealizedPnl)}
                  </span>
                </div>
              ))}
              {totalOpenPositions > 5 && (
                <div className="px-4 py-2.5 text-center">
                  <span className="text-[10px] text-muted-foreground/50">+{totalOpenPositions - 5} más</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PnL Chart ── */}
        {pnlHistory.data && pnlHistory.data.length > 0 && (
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <BarChart3 className="h-3.5 w-3.5 text-primary" />
                </div>
                <h3 className="font-bold text-xs">Rendimiento 14d</h3>
              </div>
              <span className={`text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-md ${realProfitPct >= 0 ? 'text-primary bg-primary/8' : 'text-destructive bg-destructive/8'}`}>{fmtPct(realProfitPct)}</span>
            </div>
            <ResponsiveContainer width="100%" height={110}>
              <AreaChart data={[...pnlHistory.data].reverse()} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="pnlGradMobile" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.25)' }} tickFormatter={(v) => v?.slice(5)} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.25)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: 'oklch(0.14 0.005 260)', border: '1px solid oklch(1 0 0 / 10%)', borderRadius: 12, fontSize: 11, padding: '8px 12px' }}
                  formatter={(v: any) => [fmt(parseFloat(v)), 'PnL']}
                />
                <Area type="monotone" dataKey="pnl" stroke="oklch(0.72 0.19 160)" fill="url(#pnlGradMobile)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Recent Trades ── */}
        <div className="glass-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Zap className="h-3.5 w-3.5 text-primary" />
              </div>
              <h3 className="font-bold text-xs">Últimas Operaciones</h3>
            </div>
            {tradesQuery.data && tradesQuery.data.length > 0 && (
              <span className="text-[10px] text-muted-foreground/40 tabular-nums font-medium">{tradesQuery.data.length} ops</span>
            )}
          </div>
          <div className="divide-y divide-border/10">
            {(!tradesQuery.data || tradesQuery.data.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <Activity className="h-10 w-10 opacity-10 mb-3" />
                <span className="text-xs font-medium">Sin operaciones aún</span>
                <span className="text-[10px] text-muted-foreground/50 mt-1">Las operaciones aparecerán aquí</span>
              </div>
            ) : (
              tradesQuery.data.slice(0, 8).map((t: any) => {
                const pnl = parseFloat(String(t.pnl ?? "0"));
                const date = t.createdAt ? new Date(t.createdAt) : null;
                return (
                  <div key={t.id} className="flex items-center justify-between px-4 py-3 hover:bg-accent/10 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-1 h-8 rounded-full ${t.side === "buy" ? "bg-primary" : pnl >= 0 ? "bg-[oklch(0.72_0.19_160)]" : "bg-[oklch(0.63_0.24_25)]"}`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{t.symbol?.replace("USDT", "")}</span>
                          <Badge
                            variant={t.side === "buy" ? "default" : "destructive"}
                            className="text-[8px] px-1.5 py-0 h-4 font-bold"
                          >
                            {t.side === "buy" ? "C" : "V"}
                          </Badge>
                          {t.strategyType && (
                            <span className="text-[8px] text-muted-foreground/50 capitalize font-medium">{t.strategyType}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted-foreground/60 tabular-nums">${fmtPrice(parseFloat(String(t.price ?? "0")))}</span>
                          {date && <span className="text-[9px] text-muted-foreground/40">{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                        </div>
                      </div>
                    </div>
                    <span className={`text-sm font-bold tabular-nums ${pnl > 0 ? "text-[oklch(0.72_0.19_160)]" : pnl < 0 ? "text-[oklch(0.63_0.24_25)]" : "text-muted-foreground/50"}`}>
                      {hideBalances ? "••" : fmt(pnl)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Risk Management ── */}
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[oklch(0.8_0.15_85)]/10 flex items-center justify-center">
                <Shield className="h-3.5 w-3.5 text-[oklch(0.8_0.15_85)]" />
              </div>
              <h3 className="font-bold text-xs">Gestión de Riesgo</h3>
            </div>
            <Badge variant="outline" className={`text-[9px] font-bold ${dailyLoss > 200 ? "border-destructive/40 text-destructive bg-destructive/5" : "border-primary/20 text-primary bg-primary/5"}`}>
              {dailyLoss > 200 ? "ALTO" : "OK"}
            </Badge>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-[10px] mb-2">
                <span className="text-muted-foreground/70 font-medium">Max Drawdown</span>
                <span className="tabular-nums font-bold">{hideBalances ? "••" : `${(maxDrawdown * 100).toFixed(2)}%`} / 10%</span>
              </div>
              <div className="h-2 bg-[oklch(0.14_0.005_260)] rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary to-[oklch(0.75_0.14_200)] rounded-full transition-all duration-700" style={{ width: `${Math.min((maxDrawdown * 100) / 10 * 100, 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] mb-2">
                <span className="text-muted-foreground/70 font-medium">Pérdida Diaria</span>
                <span className="tabular-nums font-bold">{hideBalances ? "••" : fmtUsd(Math.abs(dailyLoss))} / $250</span>
              </div>
              <div className="h-2 bg-[oklch(0.14_0.005_260)] rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[oklch(0.8_0.15_85)] to-destructive rounded-full transition-all duration-700" style={{ width: `${Math.min((Math.abs(dailyLoss) / 250) * 100, 100)}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* ── Connection Status Footer ── */}
        <div className="rounded-xl px-4 py-2.5" style={{ background: 'oklch(0.13 0.004 260 / 60%)' }}>
          <div className="flex items-center justify-center gap-3 text-[10px] text-muted-foreground/40">
            <span className="flex items-center gap-1.5">
              {isRunning ? <span className="w-1.5 h-1.5 rounded-full bg-primary pulse-live" /> : <WifiOff className="h-3 w-3" />}
              {isRunning ? "Conectado" : "Desconectado"}
            </span>
            <span className="text-border/20">·</span>
            <span className="tabular-nums">Ciclos: {data?.cycles ?? 0}</span>
            <span className="text-border/20">·</span>
            <span className="tabular-nums">{currentTime.toLocaleTimeString()}</span>
          </div>
        </div>
      </div>
    </>
    );
  }

  // ─── Desktop Layout ───
  return (
    <>{depositDialog}
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-extrabold tracking-tight">Panel</h1>
            <div className="flex gap-1 bg-[oklch(0.15_0.005_260)] rounded-xl p-1 border border-border/30">
              {["bybit", "kucoin", "both"].map(ex => (
                <button
                  key={ex}
                  onClick={() => handleExchangeChange(ex)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${
                    selectedExchange === ex
                      ? "bg-primary/20 text-primary shadow-sm shadow-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                  }`}
                >
                  {exchangeLabel(ex)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <Badge variant={isRunning ? "default" : "secondary"} className={`${isRunning ? "bg-primary/15 text-primary border border-primary/30" : "border border-border/50"}`}>
              {isRunning ? <><span className="w-1.5 h-1.5 rounded-full bg-primary pulse-live mr-1.5 inline-block" /> EN VIVO</> : <><WifiOff className="h-3 w-3 mr-1" /> DESCONECTADO</>}
            </Badge>
            {state?.simulationMode && <Badge variant="outline" className="border-[oklch(0.8_0.15_85)] text-[oklch(0.8_0.15_85)]">SIMULACIÓN</Badge>}
            {uptime && <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{uptime}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setHideBalances(!hideBalances)} className="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-accent/50 transition-all">
            {hideBalances ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
          </button>
          <Popover open={bellOpen} onOpenChange={(open) => { setBellOpen(open); if (open && unread > 0) markRead.mutate(); }}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                {unread > 0 && (
                  <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-destructive text-[10px] font-bold flex items-center justify-center text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0 glass-card-elevated" align="end">
              <div className="p-3 border-b border-border/30"><h4 className="font-semibold text-sm">Notificaciones</h4></div>
              <div className="max-h-64 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4 text-center">Sin notificaciones</p>
                ) : notifications.map((n: any) => (
                  <div key={n.id} className="p-3 border-b border-border/20 last:border-0 hover:bg-accent/20 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{n.symbol}</span>
                      <Badge variant={String(n.signal).includes("BUY") ? "default" : "destructive"} className="text-[10px]">
                        {String(n.signal).includes("BUY") ? "COMPRA" : "VENTA"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Confianza: {n.confidence}%</p>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {!isRunning ? (
            <Button onClick={() => startBot.mutate()} className="gap-2 font-bold shadow-lg shadow-primary/15" disabled={startBot.isPending}>
              <Play className="h-4 w-4" /> Iniciar
            </Button>
          ) : (
            <>
              <Button onClick={() => stopBot.mutate()} variant="secondary" className="gap-2 font-semibold" disabled={stopBot.isPending}>
                <Square className="h-4 w-4" /> Detener
              </Button>
              <Button onClick={() => emergencyStop.mutate()} variant="destructive" className="gap-2 font-semibold" disabled={emergencyStop.isPending}>
                <AlertTriangle className="h-4 w-4" /> Emergencia
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Desktop Price Ticker */}
      <div className="grid grid-cols-4 gap-3">
        {tickerPairs.map(({ symbol, label, icon, color }) => {
          const p = (livePrices as any)[symbol];
          const price = p?.lastPrice ?? 0;
          const change = p?.price24hPcnt ? p.price24hPcnt * 100 : 0;
          const isUp = change >= 0;
          return (
            <div key={symbol} className="glass-card p-4 flex items-center justify-between group hover:border-primary/15 transition-all interactive-card">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black" style={{ background: `color-mix(in oklch, ${color} 12%, transparent)`, color }}>
                  {icon}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{label}/USDT</p>
                  <p className="text-lg font-bold tabular-nums">{price > 0 ? "$" + fmtPrice(price) : "—"}</p>
                </div>
              </div>
              {price > 0 && (
                <span className={`text-sm font-bold flex items-center gap-0.5 px-2 py-1 rounded-lg ${isUp ? "text-[oklch(0.72_0.19_160)] bg-[oklch(0.72_0.19_160)]/10" : "text-[oklch(0.63_0.24_25)] bg-[oklch(0.63_0.24_25)]/10"}`}>
                  {isUp ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                  {fmtPct(change)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop Main Content */}
      <div className="grid grid-cols-3 gap-4">
        {/* Balance Card */}
        <div className="col-span-2 relative overflow-hidden rounded-2xl shimmer-bg" style={{ background: 'linear-gradient(145deg, oklch(0.17 0.025 160) 0%, oklch(0.14 0.012 180) 40%, oklch(0.13 0.006 240) 100%)', border: '1px solid oklch(0.72 0.19 160 / 12%)' }}>
          <div className="absolute top-0 right-0 w-56 h-56 bg-primary/6 rounded-full blur-[80px] -translate-y-16 translate-x-16" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-[oklch(0.75_0.14_200)]/5 rounded-full blur-[50px] translate-y-8 -translate-x-8" />
          <div className="relative p-7">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground/70 uppercase">Balance Total</p>
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg ${realProfitPct >= 0 ? 'bg-primary/15 text-primary border border-primary/20' : 'bg-destructive/15 text-destructive border border-destructive/20'}`}>
                {fmtPct(realProfitPct)}
              </span>
            </div>
            <p className="text-5xl font-black tracking-tight tabular-nums leading-none text-foreground">{hideBalances ? "••••••••" : fmtUsd(totalBalance)}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <p className="text-xs text-muted-foreground/50 tabular-nums">Invertido: {hideBalances ? "•••" : fmtUsd(initialDeposit)}</p>
              <button onClick={() => { setEditDepositValue(initialDeposit.toFixed(2)); setEditDepositOpen(true); }} className="text-muted-foreground/40 hover:text-primary transition-colors"><Pencil className="h-3 w-3" /></button>
            </div>
            <div className="mt-5 pt-4 border-t border-white/[0.06]">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] font-bold tracking-[0.15em] text-muted-foreground/60 uppercase">Ganancia Real</span>
                <span className={`text-xl font-black tabular-nums ${pnlColor}`}>{hideBalances ? "••••" : fmt(realProfit)}</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <span className="text-[10px] text-muted-foreground/60 block font-medium">Hoy ({todayTrades})</span>
                  <span className={`text-base font-bold tabular-nums ${todayColor}`}>{hideBalances ? "••••" : fmt(todayPnl)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground/60 block font-medium">Abierto ({openPosCount})</span>
                  <span className={`text-base font-bold tabular-nums ${unrealizedPnl >= 0 ? 'text-[oklch(0.75_0.14_200)]' : 'text-[oklch(0.8_0.15_85)]'}`}>
                    {hideBalances ? "••••" : fmt(unrealizedPnl)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground/60 block font-medium">Futuros PnL</span>
                  <span className={`text-base font-bold tabular-nums ${bybitUnrealized >= 0 ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.63_0.24_25)]'}`}>
                    {hideBalances ? "••••" : fmt(bybitUnrealized)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Column */}
        <div className="space-y-3">
          <div className="glass-card p-3.5 hover:border-primary/15 transition-all interactive-card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'color-mix(in oklch, oklch(0.8 0.18 80) 10%, transparent)' }}>
                <Wallet className="h-4.5 w-4.5" style={{ color: 'oklch(0.8 0.18 80)' }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground/60 font-medium">Bybit</span>
                  <span className="text-sm font-bold tabular-nums">{hideBalances ? "••••" : fmtUsd(bybitBal)}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[9px] text-muted-foreground/40">Disponible</span>
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">{hideBalances ? "••" : fmtUsd(bybitAvail)}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="glass-card p-3.5 hover:border-primary/15 transition-all interactive-card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'color-mix(in oklch, oklch(0.75 0.14 170) 10%, transparent)' }}>
                <Wallet className="h-4.5 w-4.5" style={{ color: 'oklch(0.75 0.14 170)' }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground/60 font-medium">KuCoin</span>
                  <span className="text-sm font-bold tabular-nums">{hideBalances ? "••••" : fmtUsd(kucoinBal)}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[9px] text-muted-foreground/40">Disponible</span>
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">{hideBalances ? "••" : fmtUsd(kucoinAvail)}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="glass-card p-3.5 hover:border-primary/15 transition-all interactive-card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'color-mix(in oklch, oklch(0.8 0.15 85) 10%, transparent)' }}>
                <Trophy className="h-4.5 w-4.5" style={{ color: 'oklch(0.8 0.15 85)' }} />
              </div>
              <div className="flex items-center justify-between flex-1">
                <span className="text-xs text-muted-foreground/60 font-medium">Win Rate</span>
                <span className="text-sm font-bold tabular-nums">{winRate.toFixed(1)}%</span>
              </div>
            </div>
          </div>
          <div className="glass-card p-3.5 hover:border-primary/15 transition-all interactive-card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'color-mix(in oklch, oklch(0.65 0.2 300) 10%, transparent)' }}>
                <Activity className="h-4.5 w-4.5" style={{ color: 'oklch(0.65 0.2 300)' }} />
              </div>
              <div className="flex items-center justify-between flex-1">
                <span className="text-xs text-muted-foreground/60 font-medium">Trades</span>
                <div className="text-right">
                  <span className="text-sm font-bold tabular-nums">{totalTrades}</span>
                  <span className="text-[9px] text-muted-foreground/40 block">{todayTrades} hoy</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop Charts Row */}
      <div className="grid grid-cols-2 gap-4">
        {/* PnL by Pair */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <BarChart3 className="h-4 w-4 text-primary" />
            </div>
            <h3 className="font-bold text-sm">PnL por Par</h3>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="pair" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} axisLine={false} />
              <Tooltip
                contentStyle={{ background: 'oklch(0.14 0.005 260)', border: '1px solid oklch(1 0 0 / 10%)', borderRadius: 12, fontSize: 12 }}
                formatter={(v: any) => [fmt(parseFloat(v)), 'PnL']}
              />
              <Bar dataKey="pnl" radius={[6, 6, 0, 0]} fill="oklch(0.72 0.19 160)" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Recent Trades */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <h3 className="font-bold text-sm">Últimas Operaciones</h3>
          </div>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {(!tradesQuery.data || tradesQuery.data.length === 0) ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <Activity className="h-8 w-8 opacity-10 mb-2" />
                <span className="text-sm font-medium">Sin operaciones</span>
              </div>
            ) : (
              tradesQuery.data.slice(0, 8).map((t: any) => {
                const pnl = parseFloat(String(t.pnl ?? "0"));
                return (
                  <div key={t.id} className="flex items-center justify-between py-2 border-b border-border/15 last:border-0 hover:bg-accent/10 transition-colors rounded-lg px-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={t.side === "buy" ? "default" : "destructive"} className="text-[9px] w-10 justify-center shrink-0 font-bold">
                        {t.side === "buy" ? "C" : "V"}
                      </Badge>
                      <span className="text-sm font-bold">{t.symbol?.replace("USDT", "")}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground/50 tabular-nums">${fmtPrice(parseFloat(String(t.price ?? "0")))}</span>
                      <span className={`text-xs font-bold tabular-nums min-w-16 text-right ${pnl > 0 ? "text-[oklch(0.72_0.19_160)]" : pnl < 0 ? "text-[oklch(0.63_0.24_25)]" : "text-muted-foreground/50"}`}>
                        {hideBalances ? "••" : fmt(pnl)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Desktop Risk + PnL History */}
      <div className="grid grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[oklch(0.8_0.15_85)]/10 flex items-center justify-center">
                <Shield className="h-4 w-4 text-[oklch(0.8_0.15_85)]" />
              </div>
              <h3 className="font-bold text-sm">Gestión de Riesgo</h3>
            </div>
            <Badge variant="outline" className={`text-[10px] font-bold ${dailyLoss > 200 ? "border-destructive/40 text-destructive bg-destructive/5" : "border-primary/20 text-primary bg-primary/5"}`}>
              {dailyLoss > 200 ? "ALTO" : "OK"}
            </Badge>
          </div>
          <div className="space-y-5">
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-muted-foreground/70 font-medium">Max Drawdown</span>
                <span className="tabular-nums font-bold">{hideBalances ? "••" : `${(maxDrawdown * 100).toFixed(2)}%`} / 10%</span>
              </div>
              <div className="h-2.5 bg-[oklch(0.14_0.005_260)] rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary to-[oklch(0.75_0.14_200)] rounded-full transition-all duration-700" style={{ width: `${Math.min((maxDrawdown * 100) / 10 * 100, 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-muted-foreground/70 font-medium">Pérdida Diaria</span>
                <span className="tabular-nums font-bold">{hideBalances ? "••" : fmtUsd(Math.abs(dailyLoss))} / $250</span>
              </div>
              <div className="h-2.5 bg-[oklch(0.14_0.005_260)] rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[oklch(0.8_0.15_85)] to-destructive rounded-full transition-all duration-700" style={{ width: `${Math.min((Math.abs(dailyLoss) / 250) * 100, 100)}%` }} />
              </div>
            </div>
          </div>
        </div>

        {pnlHistory.data && pnlHistory.data.length > 0 && (
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-primary" />
              </div>
              <h3 className="font-bold text-sm">Historial PnL (14 días)</h3>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={[...pnlHistory.data].reverse()} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="pnlGradDesktop" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} tickFormatter={(v) => v?.slice(5)} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: 'oklch(0.14 0.005 260)', border: '1px solid oklch(1 0 0 / 10%)', borderRadius: 12, fontSize: 12 }}
                  formatter={(v: any) => [fmt(parseFloat(v)), 'PnL']}
                />
                <Area type="monotone" dataKey="pnl" stroke="oklch(0.72 0.19 160)" fill="url(#pnlGradDesktop)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Desktop Footer */}
      <div className="rounded-xl px-4 py-2.5" style={{ background: 'oklch(0.13 0.004 260 / 60%)' }}>
        <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground/40">
          <span className="flex items-center gap-1.5">{isRunning ? <span className="w-1.5 h-1.5 rounded-full bg-primary pulse-live" /> : <WifiOff className="h-3 w-3" />} {isRunning ? "Conectado" : "Desconectado"}</span>
          <span className="text-border/20">·</span>
          <span className="tabular-nums">Ciclos: {data?.cycles ?? 0}</span>
          <span className="text-border/20">·</span>
          <span className="tabular-nums">{currentTime.toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  </>
  );
}
