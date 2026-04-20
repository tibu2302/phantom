import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Key, Shield, Trash2, CheckCircle, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export default function ApiKeys() {
  const { data: existing, isLoading } = trpc.apiKeys.get.useQuery();
  const utils = trpc.useUtils();
  const saveMut = trpc.apiKeys.save.useMutation({
    onSuccess: () => { utils.apiKeys.get.invalidate(); toast.success("Claves API guardadas"); setApiKey(""); setApiSecret(""); },
    onError: () => toast.error("Error al guardar"),
  });
  const deleteMut = trpc.apiKeys.delete.useMutation({
    onSuccess: () => { utils.apiKeys.get.invalidate(); toast.success("Claves API eliminadas"); },
  });

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [label, setLabel] = useState("Bybit Main");

  if (isLoading) return <div className="space-y-4 animate-pulse"><div className="h-64 glass-card rounded-xl" /></div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Key className="h-6 w-6 text-primary" /> Claves API</h1>
        <p className="text-sm text-muted-foreground mt-1">Conectá tu cuenta de Bybit de forma segura</p>
      </div>

      {existing ? (
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-primary" />
              <div>
                <p className="font-semibold">Conectado</p>
                <p className="text-xs text-muted-foreground">API Key: {existing.apiKey}</p>
              </div>
            </div>
            <Badge className="bg-primary/20 text-primary border-primary/30">Activo</Badge>
          </div>
          <Button variant="destructive" onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending} className="gap-2">
            <Trash2 className="h-4 w-4" /> Eliminar Claves
          </Button>
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
              <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Ej: Bybit Principal" className="bg-secondary/50 border-border" />
            </div>
            <div className="space-y-2">
              <Label>Clave API</Label>
              <Input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Ingresá tu Clave API de Bybit" className="bg-secondary/50 border-border font-mono" />
            </div>
            <div className="space-y-2">
              <Label>Secreto API</Label>
              <div className="relative">
                <Input type={showSecret ? "text" : "password"} value={apiSecret} onChange={e => setApiSecret(e.target.value)} placeholder="Ingresá tu Secreto API de Bybit" className="bg-secondary/50 border-border font-mono pr-10" />
                <button onClick={() => setShowSecret(!showSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <Button onClick={() => saveMut.mutate({ apiKey, apiSecret, label })} disabled={!apiKey || !apiSecret || saveMut.isPending} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
            {saveMut.isPending ? "Guardando..." : "Guardar Claves API"}
          </Button>
        </div>
      )}

      <div className="glass-card p-5 space-y-3">
        <h3 className="font-semibold text-sm">Cómo obtener tus Claves API</h3>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Iniciá sesión en tu cuenta de Bybit</li>
          <li>Andá a Cuenta &rarr; Gestión de API</li>
          <li>Hacé click en "Crear Nueva Clave"</li>
          <li>Habilitá: permisos de Spot, Futuros, Wallet</li>
          <li>Copiá la Clave API y el Secreto acá</li>
        </ol>
      </div>
    </div>
  );
}
