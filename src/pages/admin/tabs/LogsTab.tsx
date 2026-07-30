import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { usePermissoes } from "@/context/PermissoesContext";
import { RefreshCw, CheckCircle2, XCircle, LogOut, AlertTriangle } from "lucide-react";

interface LogEntry {
  id: string;
  created_at: string;
  ip_address: string | null;
  payload: any;
}

export function LogsTab() {
  const qc = useQueryClient();
  const { can } = usePermissoes();
  const podeVer = can("visualizar", undefined, "administracao");

  const logsQ = useQuery({
    enabled: podeVer,
    queryKey: ["admin_auth_logs"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_auth_logs", { _limit: 200 });
      if (error) throw error;
      return (data ?? []) as LogEntry[];
    },
  });

  if (!podeVer) {
    return <section className="card-elevated p-6 text-sm text-muted-foreground">Apenas administradores podem visualizar logs de acesso.</section>;
  }

  return (
    <section className="card-elevated">
      <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div>
          <h2 className="font-display text-sm font-bold">Logs de acesso</h2>
          <p className="text-xs text-muted-foreground">Últimos {logsQ.data?.length ?? 0} eventos de autenticação (Supabase Auth).</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["admin_auth_logs"] })} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar
        </Button>
      </header>
      <ul className="max-h-[600px] divide-y divide-border overflow-y-auto">
        {logsQ.isLoading && <li className="px-5 py-6 text-center text-sm text-muted-foreground">Carregando…</li>}
        {!logsQ.isLoading && (logsQ.data ?? []).length === 0 && (
          <li className="px-5 py-6 text-center text-sm text-muted-foreground">Sem registros.</li>
        )}
        {(logsQ.data ?? []).map((l) => {
          const action = l.payload?.action ?? l.payload?.event ?? "evento";
          const actor = l.payload?.actor_username ?? l.payload?.actor_email ?? l.payload?.actor_id ?? "—";
          const error = l.payload?.error ?? null;
          let Icon = CheckCircle2; let tone = "text-success";
          if (action === "logout") { Icon = LogOut; tone = "text-muted-foreground"; }
          if (error || /failed|invalid/i.test(JSON.stringify(l.payload ?? {}))) { Icon = XCircle; tone = "text-destructive"; }
          if (/recovery|password_reset/i.test(action)) { Icon = AlertTriangle; tone = "text-warning"; }
          return (
            <li key={l.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <Icon className={`h-4 w-4 shrink-0 ${tone}`} />
              <span className="w-40 text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString("pt-BR")}</span>
              <span className="w-56 truncate text-xs font-medium">{actor}</span>
              <span className="flex-1 text-xs text-muted-foreground capitalize">{action.replace(/_/g, " ")}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{l.ip_address ?? "—"}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
