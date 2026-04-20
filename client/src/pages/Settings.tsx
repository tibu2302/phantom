import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings, Save, AlertTriangle, Shield, Ghost } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function SettingsPage() {
  const utils = trpc.useUtils();
  const { data: botData } = trpc.bot.status.useQuery();
  const updateConfig = trpc.bot.updateConfig.useMutation({
    onSuccess: () => { utils.bot.status.invalidate(); toast.success("Settings saved"); },
  });

  const [simulationMode, setSimulationMode] = useState(true);
  const [initialBalance, setInitialBalance] = useState("5000");

  useEffect(() => {
    if (botData?.state) {
      setSimulationMode(botData.state.simulationMode);
      setInitialBalance(botData.state.initialBalance || "5000");
    }
  }, [botData?.state]);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" /> Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Configure your bot parameters and preferences.</p>
      </div>

      {/* Trading Mode */}
      <div className="glass rounded-xl p-5">
        <h3 className="text-sm font-semibold mb-1">Trading Mode</h3>
        <p className="text-xs text-muted-foreground mb-4">Control whether the bot executes real trades or runs in simulation.</p>
        
        <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 mb-3">
          <div className="flex items-center gap-3">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${simulationMode ? "bg-primary/10" : "bg-red-500/10"}`}>
              {simulationMode ? <Shield className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-red-400" />}
            </div>
            <div>
              <p className="text-sm font-medium">Simulation Mode</p>
              <p className="text-[11px] text-muted-foreground">When enabled, no real trades are executed.</p>
            </div>
          </div>
          <Switch checked={simulationMode} onCheckedChange={setSimulationMode} />
        </div>

        {!simulationMode && (
          <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
              <p className="text-xs font-semibold text-red-400">Live Trading Active</p>
            </div>
            <p className="text-[11px] text-red-400/70 ml-5">Real money will be used for trades. Proceed with caution.</p>
          </div>
        )}
      </div>

      {/* Capital Configuration */}
      <div className="glass rounded-xl p-5">
        <h3 className="text-sm font-semibold mb-1">Capital Configuration</h3>
        <p className="text-xs text-muted-foreground mb-4">Set your initial trading capital for PnL calculations.</p>
        
        <div className="space-y-2">
          <Label htmlFor="balance" className="text-xs">Initial Balance (USD)</Label>
          <Input
            id="balance"
            type="number"
            value={initialBalance}
            onChange={(e) => setInitialBalance(e.target.value)}
            placeholder="5000"
            className="font-mono bg-secondary/50 border-border/50 h-10"
          />
          <p className="text-[11px] text-muted-foreground">Used to calculate percentage returns and risk limits.</p>
        </div>
      </div>

      <Button
        onClick={() => updateConfig.mutate({ simulationMode, initialBalance })}
        disabled={updateConfig.isPending}
        className="w-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 h-10"
      >
        <Save className="h-3.5 w-3.5 mr-1.5" />
        {updateConfig.isPending ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  );
}
