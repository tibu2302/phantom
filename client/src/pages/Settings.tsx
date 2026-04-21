import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings as SettingsIcon, Save, Send, Bell, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect } from "react";

export default function Settings() {
  const { data } = trpc.bot.status.useQuery();
  const utils = trpc.useUtils();
  const updateMut = trpc.bot.updateSettings.useMutation({
    onSuccess: () => { utils.bot.status.invalidate(); toast.success("Ajustes guardados"); },
    onError: () => toast.error("Error al guardar ajustes"),
  });

  const [simulationMode, setSimulationMode] = useState(true);
  const [initialBalance, setInitialBalance] = useState("5000");

  // Telegram config
  const { data: telegramConfig } = trpc.telegram.getConfig.useQuery();
  const saveTelegramMut = trpc.telegram.saveConfig.useMutation({
    onSuccess: () => { utils.telegram.getConfig.invalidate(); toast.success("Telegram configurado correctamente"); },
    onError: () => toast.error("Error al guardar config de Telegram"),
  });
  const testTelegramMut = trpc.telegram.testNotification.useMutation({
    onSuccess: (res) => {
      if (res.success) toast.success("Notificación de prueba enviada a Telegram");
      else toast.error(res.error || "Error al enviar notificación");
    },
    onError: () => toast.error("Error al enviar notificación"),
  });

  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");

  useEffect(() => {
    if (data?.state) {
      setSimulationMode(data.state.simulationMode ?? true);
      setInitialBalance(String(data.state.initialBalance ?? "5000"));
    }
  }, [data?.state]);

  const handleSave = () => {
    updateMut.mutate({ simulationMode, initialBalance });
  };

  const handleSaveTelegram = () => {
    if (!botToken || !chatId) { toast.error("Completá ambos campos"); return; }
    saveTelegramMut.mutate({ botToken, chatId });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><SettingsIcon className="h-6 w-6 text-primary" /> Ajustes</h1>
        <p className="text-sm text-muted-foreground mt-1">Configurá tu bot PHANTOM</p>
      </div>

      <div className="glass-card p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold">Modo Simulación</p>
            <p className="text-sm text-muted-foreground">Operá con dinero virtual para probar estrategias de forma segura</p>
          </div>
          <Switch checked={simulationMode} onCheckedChange={setSimulationMode} />
        </div>

        <div className="border-t border-border pt-6 space-y-2">
          <Label>Saldo Inicial (USD)</Label>
          <Input type="number" value={initialBalance} onChange={e => setInitialBalance(e.target.value)} className="bg-secondary/50 border-border font-mono" />
          <p className="text-xs text-muted-foreground">El capital inicial para cálculos de PnL</p>
        </div>

        <Button onClick={handleSave} disabled={updateMut.isPending} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
          <Save className="h-4 w-4" /> {updateMut.isPending ? "Guardando..." : "Guardar Ajustes"}
        </Button>
      </div>

      {/* Telegram Notifications */}
      <div className="glass-card p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-blue-400" />
          <h2 className="text-lg font-semibold">Notificaciones Telegram</h2>
          {telegramConfig && <CheckCircle className="h-4 w-4 text-green-400 ml-auto" />}
        </div>
        <p className="text-sm text-muted-foreground">Recibí notificaciones en tiempo real cuando el bot ejecuta operaciones rentables.</p>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Bot Token</Label>
            <Input
              type="password"
              placeholder={telegramConfig ? telegramConfig.botToken : "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"}
              value={botToken}
              onChange={e => setBotToken(e.target.value)}
              className="bg-secondary/50 border-border font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">Creá un bot en <a href="https://t.me/BotFather" target="_blank" className="text-primary hover:underline">@BotFather</a> y copiá el token</p>
          </div>

          <div className="space-y-2">
            <Label>Chat ID</Label>
            <Input
              placeholder={telegramConfig ? telegramConfig.chatId : "Tu Chat ID"}
              value={chatId}
              onChange={e => setChatId(e.target.value)}
              className="bg-secondary/50 border-border font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">Enviá /start a <a href="https://t.me/userinfobot" target="_blank" className="text-primary hover:underline">@userinfobot</a> para obtener tu Chat ID</p>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSaveTelegram} disabled={saveTelegramMut.isPending} className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
              <Save className="h-4 w-4" /> {saveTelegramMut.isPending ? "Guardando..." : "Guardar"}
            </Button>
            <Button
              variant="outline"
              onClick={() => testTelegramMut.mutate()}
              disabled={testTelegramMut.isPending || !telegramConfig}
              className="gap-2"
            >
              <Send className="h-4 w-4" /> {testTelegramMut.isPending ? "Enviando..." : "Probar"}
            </Button>
          </div>
        </div>
      </div>

      <div className="glass-card p-5 space-y-3">
        <h3 className="font-semibold text-sm">Acerca de PHANTOM</h3>
        <div className="text-sm text-muted-foreground space-y-1">
          <p>Versión 2.0.0</p>
          <p>Estrategias: Grid Trading, Scalping, Futuros Long-Only, DCA</p>
          <p>Mercados: Crypto (BTC, ETH, SOL, XRP, DOGE, ADA, AVAX, LINK, ARB, SUI) + TradFi (XAU)</p>
          <p>Features: Trailing Stop, Reinversión Automática, Grid Dinámico, Multi-Timeframe, Filtro de Volumen</p>
          <p>Exchanges: Bybit + KuCoin (simultáneo)</p>
          <p>Scanner: +30 monedas analizadas cada 2 minutos</p>
        </div>
      </div>
    </div>
  );
}
