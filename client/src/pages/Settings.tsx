import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings as SettingsIcon, Save } from "lucide-react";
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

  useEffect(() => {
    if (data?.state) {
      setSimulationMode(data.state.simulationMode ?? true);
      setInitialBalance(String(data.state.initialBalance ?? "5000"));
    }
  }, [data?.state]);

  const handleSave = () => {
    updateMut.mutate({ simulationMode, initialBalance });
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

      <div className="glass-card p-5 space-y-3">
        <h3 className="font-semibold text-sm">Acerca de PHANTOM</h3>
        <div className="text-sm text-muted-foreground space-y-1">
          <p>Versión 1.0.0</p>
          <p>Estrategias: Grid Trading, Scalping</p>
          <p>Mercados: Crypto (BTC, ETH) + TradFi (SP500)</p>
          <p>Scanner: +30 monedas analizadas cada 2 minutos</p>
        </div>
      </div>
    </div>
  );
}
