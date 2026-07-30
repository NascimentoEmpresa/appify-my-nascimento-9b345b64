import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { usePermissoes } from "@/context/PermissoesContext";
import { RefreshCw } from "lucide-react";

interface Sessao {
  id: string; user_id: string; email: string | null;
  display_name: string | null;
  created_at: string; refreshed_at: string | null;
  user_agent: string | null; ip: string | null;
}

export function SessoesTab() {
  const qc = useQueryClient();
  const { can } = usePermissoes();
  const podeGerenciar = can("alterar", undefined, "administracao");

  const sessoesQ = useQuery({
    enabled: podeGerenciar,
    queryKey: ["admin_active_sessions"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_active_sessions");
      if (error) throw error;
      return (data ?? []) as Sessao[];
    },
  });

  const encerrar = async (userId: string, nome: string | null) => {
    if (!confirm(`Encerrar TODAS as sessões de ${nome ?? userId}?`)) return;
    const { data, error } = await supabase.functions.invoke("admin-revoke-session", { body: { user_id: userId } });
    if (error || (data as any)?.error) {
      toast({ title: "Erro", description: error?.message ?? (data as any)?.error, variant: "destructive" });
      return;
    }
    toast({ title: "Sessões encerradas" });
    qc.invalidateQueries({ queryKey: ["admin_active_sessions"] });
  };

  if (!podeGerenciar) {
    return <section className="card-elevated p-6 text-sm text-muted-foreground">Apenas administradores podem visualizar sessões ativas.</section>;
  }

  return (
    <section className="card-elevated">
      <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div>
          <h2 className="font-display text-sm font-bold">
            Sessões ativas
            <span className="ml-2 chip border border-success/30 bg-success-soft text-success">{sessoesQ.data?.length ?? 0} online</span>
          </h2>
          <p className="text-xs text-muted-foreground">Sessões válidas no servidor de autenticação Supabase.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["admin_active_sessions"] })} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar
        </Button>
      </header>
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-5 py-3 text-left">Usuário</th>
            <th className="px-3 py-3 text-left">IP</th>
            <th className="px-3 py-3 text-left">Dispositivo / User-Agent</th>
            <th className="px-3 py-3 text-left">Última atividade</th>
            <th className="px-5 py-3 text-right">Ação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sessoesQ.isLoading && <tr><td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">Carregando…</td></tr>}
          {!sessoesQ.isLoading && (sessoesQ.data ?? []).length === 0 && (
            <tr><td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">Nenhuma sessão ativa.</td></tr>
          )}
          {(sessoesQ.data ?? []).map((s) => (
            <tr key={s.id} className="hover:bg-muted/40">
              <td className="px-5 py-3">
                <p className="text-sm font-medium">{s.display_name ?? "—"}</p>
                <p className="text-[11px] text-muted-foreground">{s.email}</p>
              </td>
              <td className="px-3 py-3 font-mono text-xs">{s.ip ?? "—"}</td>
              <td className="px-3 py-3 text-xs text-muted-foreground">{s.user_agent ?? "—"}</td>
              <td className="px-3 py-3 text-xs">{new Date(s.refreshed_at ?? s.created_at).toLocaleString("pt-BR")}</td>
              <td className="px-5 py-3 text-right">
                <Button size="sm" variant="ghost" onClick={() => encerrar(s.user_id, s.display_name)} className="text-destructive hover:text-destructive">
                  Encerrar sessões
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
