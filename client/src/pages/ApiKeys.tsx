import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Key, Shield, Trash2, CheckCircle, Eye, EyeOff, Zap } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

const EXCHANGES = [
  { id: "bybit", name: "Bybit", color: "text-yellow-400", needsPassphrase: false },
  { id: "kucoin", name: "KuCoin", color: "text-emerald-400", needsPassphrase: true },
] as const;

type ExchangeId = (typeof EXCHANGES)[number]["id"];

export default function ApiKeys() {
  const [activeExchange, setActiveExchange] = useState<ExchangeId>("bybit");
  const exchange = EXCHANGES.find(e => e.id === activeExchange)!;

  const { data: allKeys, isLoading } = trpc.apiKeys.get.useQuery();
  const utils = trpc.useUtils();

  const saveMut = trpc.apiKeys.save.useMutation({
    onSuccess: () => {
      utils.apiKeys.get.invalidate();
      toast.success(`Claves ${exchange.name} guardadas`);
      setApiKey(""); setApiSecret(""); setPassphrase("");
    },
    onError: () => toast.error("Error al guardar"),
  });
  const deleteMut = trpc.apiKeys.delete.useMutation({
    onSuccess: () => {
      utils.apiKeys.get.invalidate();
      toast.success(`Claves ${exchange.name} eliminadas`);
    },
  });
  const testMut = trpc.apiKeys.testConnection.useMutation({
    onSuccess: (res) => {
      if (res.success) toast.success(`${exchange.name} conectado — Balance: $${res.balance}`);
      else toast.error(res.error ?? "Error de conexión");
    },
    onError: () => toast.error("Error de conexión"),
  });

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [label, setLabel] = useState("Principal");

  if (isLoading) return <div className="space-y-4 animate-pulse"><div className="h-64 glass-card rounded-xl" /></div>;

  // Find existing key for the active exchange
  const keysList = Array.isArray(allKeys) ? allKeys : allKeys ? [allKeys] : [];
  const existing = keysList.find((k: any) => k.exchange === activeExchange);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Key className="h-6 w-6 text-primary" /> Claves API</h1>
        <p className="text-sm text-muted-foreground mt-1">Conectá tus cuentas de exchange de forma segura</p>
      </div>

      {/* Exchange Tabs */}
      <div className="flex gap-2">
        {EXCHANGES.map(ex => (
          <button
            key={ex.id}
            onClick={() => setActiveExchange(ex.id)}
            className={`flex-1 py-3 px-4 rounded-xl font-semibold text-sm transition-all border ${
              activeExchange === ex.id
                ? "bg-primary/10 border-primary/50 text-primary"
                : "bg-secondary/30 border-border text-muted-foreground hover:bg-secondary/50"
            }`}
          >
            <span className={activeExchange === ex.id ? ex.color : ""}>{ex.name}</span>
            {keysList.some((k: any) => k.exchange === ex.id) && (
              <CheckCircle className="inline ml-2 h-3.5 w-3.5 text-primary" />
            )}
          </button>
        ))}
      </div>

      {existing ? (
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-primary" />
              <div>
                <p className="font-semibold">{exchange.name} Conectado</p>
                <p className="text-xs text-muted-foreground">API Key: {existing.apiKey}</p>
                {existing.hasPassphrase && (
                  <p className="text-xs text-muted-foreground">Passphrase: ••••••</p>
                )}
              </div>
            </div>
            <Badge className="bg-primary/20 text-primary border-primary/30">Activo</Badge>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => testMut.mutate({ exchange: activeExchange })}
              disabled={testMut.isPending}
              className="gap-2"
            >
              <Zap className="h-4 w-4" /> {testMut.isPending ? "Probando..." : "Probar Conexión"}
            </Button>
            <Button variant="destructive" onClick={() => deleteMut.mutate({ exchange: activeExchange })} disabled={deleteMut.isPending} className="gap-2">
              <Trash2 className="h-4 w-4" /> Eliminar
            </Button>
          </div>
        </div>
      ) : (
        <div className="glass-card p-6 space-y-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 bg-secondary/50 rounded-lg">
            <Shield className="h-4 w-4 text-primary shrink-0" />
            Tus claves están encriptadas y almacenadas de forma segura.
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Etiqueta</Label>
              <Input value={label} onChange={e => setLabel(e.target.value)} placeholder={`Ej: ${exchange.name} Principal`} className="bg-secondary/50 border-border" />
            </div>
            <div className="space-y-2">
              <Label>Clave API</Label>
              <Input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={`Ingresá tu Clave API de ${exchange.name}`} className="bg-secondary/50 border-border font-mono" />
            </div>
            <div className="space-y-2">
              <Label>Secreto API</Label>
              <div className="relative">
                <Input type={showSecret ? "text" : "password"} value={apiSecret} onChange={e => setApiSecret(e.target.value)} placeholder={`Ingresá tu Secreto API de ${exchange.name}`} className="bg-secondary/50 border-border font-mono pr-10" />
                <button onClick={() => setShowSecret(!showSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {exchange.needsPassphrase && (
              <div className="space-y-2">
                <Label>Passphrase <span className="text-xs text-muted-foreground">(requerido para KuCoin)</span></Label>
                <Input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} placeholder="Ingresá tu Passphrase de KuCoin" className="bg-secondary/50 border-border font-mono" />
              </div>
            )}
          </div>
          <Button
            onClick={() => saveMut.mutate({
              apiKey, apiSecret, label,
              exchange: activeExchange,
              ...(exchange.needsPassphrase && passphrase ? { passphrase } : {}),
            })}
            disabled={!apiKey || !apiSecret || (exchange.needsPassphrase && !passphrase) || saveMut.isPending}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saveMut.isPending ? "Guardando..." : `Guardar Claves ${exchange.name}`}
          </Button>
        </div>
      )}

      <div className="glass-card p-5 space-y-3">
        <h3 className="font-semibold text-sm">Cómo obtener tus Claves API de {exchange.name}</h3>
        {activeExchange === "bybit" ? (
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
            <li>Iniciá sesión en tu cuenta de Bybit</li>
            <li>Andá a Cuenta &rarr; Gestión de API</li>
            <li>Hacé click en "Crear Nueva Clave"</li>
            <li>Habilitá: permisos de Spot, Futuros, Wallet</li>
            <li>Copiá la Clave API y el Secreto acá</li>
          </ol>
        ) : (
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
            <li>Iniciá sesión en tu cuenta de KuCoin</li>
            <li>Andá a Perfil &rarr; Gestión de API</li>
            <li>Hacé click en "Crear API"</li>
            <li>Creá un Passphrase (lo vas a necesitar acá)</li>
            <li>Habilitá: permisos de Spot Trading y General</li>
            <li>Copiá la Clave API, el Secreto y el Passphrase acá</li>
          </ol>
        )}
      </div>
    </div>
  );
}
