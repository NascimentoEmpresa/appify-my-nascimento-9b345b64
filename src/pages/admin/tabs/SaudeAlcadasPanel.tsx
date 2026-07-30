import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { usePermissoes } from "@/context/PermissoesContext";
import { ShieldCheck, AlertTriangle, Trash2, Plus, Users, Workflow, Clock } from "lucide-react";

/**
 * Painel de Saúde do motor de Alçadas — só visível para admin/presidência/controladoria.
 * Mostra KPIs (CCs sem gestor, fluxos sem etapa, instâncias com SLA estourado) e
 * permite conceder/revogar a permissão especial "alterar_empresa_cc".
 */
export function SaudeAlcadasPanel() {
  const { can } = usePermissoes();
  const podeVer = can("visualizar", undefined, "administracao");
  const podeGerenciar = can("alterar", undefined, "administracao");

  if (!podeVer) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        Restrito a administradores, presidência e controladoria.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <KpisSaude />
      <PermissoesEspeciaisPanel podeGerenciar={podeGerenciar} />
    </div>
  );
}

// ============================================================
// KPIs
// ============================================================
function KpisSaude() {
  const ccsSemGestorQ = useQuery({
    queryKey: ["saude-ccs-sem-gestor"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("centros_custo")
        .select("id, codigo, nome, empresa_id, gestor_user_id")
        .eq("ativo", true)
        .is("gestor_user_id", null)
        .order("codigo");
      if (error) throw error;
      return data ?? [];
    },
  });

  const fluxosSemEtapaQ = useQuery({
    queryKey: ["saude-fluxos-sem-etapa"],
    queryFn: async () => {
      const { data: fluxos, error } = await (supabase as any)
        .from("sup_aprov_fluxo")
        .select("id, nome, alvo, empresa_id, ativo")
        .eq("ativo", true);
      if (error) throw error;
      const ids = (fluxos ?? []).map((f: any) => f.id);
      if (ids.length === 0) return [];
      const { data: etapas } = await (supabase as any)
        .from("sup_aprov_etapa")
        .select("fluxo_id")
        .is("instancia_id", null)
        .eq("ativo", true)
        .in("fluxo_id", ids);
      const comEtapa = new Set((etapas ?? []).map((e: any) => e.fluxo_id));
      return (fluxos ?? []).filter((f: any) => !comEtapa.has(f.id));
    },
  });

  const slaEstouradoQ = useQuery({
    queryKey: ["saude-sla-estourado"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sup_aprov_instancia")
        .select("id, alvo, referencia_codigo, aberta_em, empresa_id, status")
        .eq("status", "pendente")
        .order("aberta_em", { ascending: true })
        .limit(50);
      if (error) throw error;
      const agora = Date.now();
      return (data ?? []).filter((i: any) => {
        const h = (agora - new Date(i.aberta_em).getTime()) / 36e5;
        return h > 48; // >48h parada
      });
    },
  });

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
        <ShieldCheck className="h-4 w-4" /> Indicadores de saúde
      </h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiCard
          icon={Users}
          label="CCs sem gestor"
          value={ccsSemGestorQ.data?.length ?? 0}
          loading={ccsSemGestorQ.isLoading}
          tone={(ccsSemGestorQ.data?.length ?? 0) > 0 ? "warn" : "ok"}
          hint="Bloqueia abertura de RC."
        />
        <KpiCard
          icon={Workflow}
          label="Fluxos sem etapa ativa"
          value={fluxosSemEtapaQ.data?.length ?? 0}
          loading={fluxosSemEtapaQ.isLoading}
          tone={(fluxosSemEtapaQ.data?.length ?? 0) > 0 ? "warn" : "ok"}
          hint="Aprovação nunca abrirá."
        />
        <KpiCard
          icon={Clock}
          label="Instâncias > 48h paradas"
          value={slaEstouradoQ.data?.length ?? 0}
          loading={slaEstouradoQ.isLoading}
          tone={(slaEstouradoQ.data?.length ?? 0) > 0 ? "warn" : "ok"}
          hint="Candidatas a escalonamento."
        />
      </div>

      {(ccsSemGestorQ.data ?? []).length > 0 && (
        <details className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs dark:bg-amber-950/30">
          <summary className="cursor-pointer font-semibold text-amber-900 dark:text-amber-200">
            Ver {ccsSemGestorQ.data!.length} CC(s) sem gestor
          </summary>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
            {ccsSemGestorQ.data!.slice(0, 60).map((c: any) => (
              <li key={c.id} className="font-mono">{c.codigo} — {c.nome}</li>
            ))}
          </ul>
          {ccsSemGestorQ.data!.length > 60 && (
            <p className="mt-2 italic">…e mais {ccsSemGestorQ.data!.length - 60}.</p>
          )}
        </details>
      )}

      {(fluxosSemEtapaQ.data ?? []).length > 0 && (
        <details className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs dark:bg-amber-950/30">
          <summary className="cursor-pointer font-semibold text-amber-900 dark:text-amber-200">
            Ver {fluxosSemEtapaQ.data!.length} fluxo(s) sem etapa
          </summary>
          <ul className="mt-2 space-y-1">
            {fluxosSemEtapaQ.data!.map((f: any) => (
              <li key={f.id}><span className="font-mono">{f.alvo}</span> — {f.nome}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, hint, loading, tone,
}: { icon: any; label: string; value: number; hint?: string; loading?: boolean; tone: "ok" | "warn" }) {
  return (
    <div className={`rounded-lg border p-4 ${tone === "warn" ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30" : "border-border bg-card"}`}>
      <div className="flex items-center justify-between">
        <Icon className={`h-4 w-4 ${tone === "warn" ? "text-amber-600" : "text-emerald-600"}`} />
        <span className="text-2xl font-bold tabular-nums">{loading ? "…" : value}</span>
      </div>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ============================================================
// Permissões especiais (item 7)
// ============================================================
function PermissoesEspeciaisPanel({ podeGerenciar }: { podeGerenciar: boolean }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [motivo, setMotivo] = useState("");
  const PERM = "alterar_empresa_cc";

  const listaQ = useQuery({
    queryKey: ["permissoes-especiais", PERM],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("permissoes_especiais")
        .select("id, user_id, permissao, concedido_em, motivo")
        .eq("permissao", PERM)
        .order("concedido_em", { ascending: false });
      if (error) throw error;
      const uids = (data ?? []).map((r: any) => r.user_id);
      if (!uids.length) return [];
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name, email")
        .in("id", uids);
      const map: Record<string, any> = {};
      (profs ?? []).forEach((p: any) => (map[p.id] = p));
      return (data ?? []).map((r: any) => ({ ...r, profile: map[r.user_id] }));
    },
  });

  const conceder = async () => {
    if (!email.trim()) { toast({ title: "Informe o e-mail." }); return; }
    if (motivo.trim().length < 5) { toast({ title: "Motivo obrigatório (≥ 5 chars).", variant: "destructive" }); return; }
    const { data: prof } = await supabase
      .from("profiles")
      .select("id, email")
      .ilike("email", email.trim())
      .maybeSingle();
    if (!prof) { toast({ title: "Usuário não encontrado.", variant: "destructive" }); return; }
    const { data: u } = await supabase.auth.getUser();
    const { error } = await (supabase as any).from("permissoes_especiais").insert({
      user_id: prof.id,
      permissao: PERM,
      concedido_por: u.user?.id,
      motivo: motivo.trim(),
    });
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    setEmail(""); setMotivo("");
    qc.invalidateQueries({ queryKey: ["permissoes-especiais", PERM] });
    toast({ title: "Permissão concedida." });
  };

  const revogar = async (id: string) => {
    if (!confirm("Revogar esta permissão?")) return;
    const { error } = await (supabase as any).from("permissoes_especiais").delete().eq("id", id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["permissoes-especiais", PERM] });
    toast({ title: "Permissão revogada." });
  };

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
        <AlertTriangle className="h-4 w-4 text-amber-600" /> Permissão especial: alterar empresa de CC
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Apenas usuários listados aqui podem clicar em "Trocar empresa" em Controladoria → Centros de Custo.
        Ação registrada em <code>centros_custo_empresa_log</code>.
      </p>

      {podeGerenciar && (
        <div className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-border bg-muted/20 p-3 md:grid-cols-[1fr_2fr_auto]">
          <Input placeholder="E-mail do usuário" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 text-xs" />
          <Input placeholder="Motivo (auditoria)" value={motivo} onChange={(e) => setMotivo(e.target.value)} className="h-9 text-xs" />
          <Button size="sm" onClick={conceder}><Plus className="mr-1 h-3 w-3" />Conceder</Button>
        </div>
      )}

      <div className="rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Usuário</th>
              <th className="px-3 py-2 text-left">Concedido em</th>
              <th className="px-3 py-2 text-left">Motivo</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {listaQ.isLoading && <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">Carregando…</td></tr>}
            {!listaQ.isLoading && (listaQ.data ?? []).length === 0 && (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">Ninguém tem esta permissão.</td></tr>
            )}
            {(listaQ.data ?? []).map((r: any) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  {r.profile?.display_name || r.profile?.email || r.user_id.slice(0, 8)}
                  {r.profile?.email && <div className="text-[10px] text-muted-foreground">{r.profile.email}</div>}
                </td>
                <td className="px-3 py-2">{new Date(r.concedido_em).toLocaleString("pt-BR")}</td>
                <td className="px-3 py-2 italic text-muted-foreground">{r.motivo || "—"}</td>
                <td className="px-3 py-2 text-right">
                  {podeGerenciar && (
                    <Button size="sm" variant="ghost" onClick={() => revogar(r.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
