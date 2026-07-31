import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshCw, ExternalLink, CheckCircle2, Clock } from "lucide-react";
import { usePermissoes } from "@/context/PermissoesContext";

const EMPRESAS = ["RAC", "SPNE", "HAGG", "LF", "NH", "SN"];

const PASSOS: Array<{ id: string; titulo: string; rota: string; rotaLabel: string; esperado: string }> = [
  { id: "rc_criar", titulo: "1. Criar Requisição de Compra (1 item baixo valor)", rota: "/app/suprimentos/requisicoes", rotaLabel: "Suprimentos › Requisições", esperado: "Sininho do gestor do CC recebe notificação. Item aparece em /app/aprovacoes." },
  { id: "rc_aprovar", titulo: "2. Gestor aprova a RC", rota: "/app/aprovacoes", rotaLabel: "Inbox › Aprovações", esperado: "Status muda para aprovado, RC liberada para virar Pedido." },
  { id: "pc_criar", titulo: "3. Criar Pedido de Compra a partir da RC", rota: "/app/suprimentos/pedidos", rotaLabel: "Suprimentos › Pedidos", esperado: "Sininho do próximo aprovador (faixa de valor) recebe notificação." },
  { id: "pc_aprovar", titulo: "4. Aprovar o Pedido", rota: "/app/aprovacoes", rotaLabel: "Inbox › Aprovações", esperado: "Status aprovado, libera NF Entrada." },
  { id: "pg_criar", titulo: "5. Criar Programação de Pagamento (1 título)", rota: "/app/financeiro/programacao-pagamentos", rotaLabel: "Financeiro › Programação", esperado: "Sininho do aprovador financeiro recebe notificação." },
  { id: "pg_aprovar", titulo: "6. Aprovar a Programação", rota: "/app/aprovacoes", rotaLabel: "Inbox › Aprovações", esperado: "Status aprovado." },
  { id: "lic_criar", titulo: "7. Criar Etapa de Licitação (Comercial)", rota: "/app/pipeline", rotaLabel: "Comercial › Pipeline", esperado: "Lucas recebe notificação (48h, bloqueante)." },
  { id: "lic_aprovar", titulo: "8. Lucas aprova a etapa", rota: "/app/aprovacoes", rotaLabel: "Inbox › Aprovações", esperado: "Status aprovado." },
];

const STORAGE_PREFIX = "smoke_helena_v1";

function chaveCheck(empresa: string, passoId: string) {
  return `${STORAGE_PREFIX}:${empresa}:${passoId}`;
}

interface AuditRow {
  id: number;
  ts: string;
  user_id: string | null;
  table_name: string;
  op: string;
  pk: string | null;
}

export default function SmokeTestHelena() {
  const qc = useQueryClient();
  const { can } = usePermissoes();
  const canSee = can("visualizar", undefined, "administracao");

  const [empresaAtual, setEmpresaAtual] = useState<string>(EMPRESAS[0]);
  const [filtroUserEmail, setFiltroUserEmail] = useState("helena");
  const [, force] = useState(0);

  const checked = useMemo(() => {
    const map: Record<string, Record<string, boolean>> = {};
    for (const e of EMPRESAS) {
      map[e] = {};
      for (const p of PASSOS) {
        map[e][p.id] = localStorage.getItem(chaveCheck(e, p.id)) === "1";
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaAtual, force]);

  function toggle(empresa: string, passoId: string, val: boolean) {
    if (val) localStorage.setItem(chaveCheck(empresa, passoId), "1");
    else localStorage.removeItem(chaveCheck(empresa, passoId));
    force((n) => n + 1);
  }

  function resetar() {
    if (!confirm("Limpar todas as marcações do smoke test?")) return;
    for (const e of EMPRESAS) for (const p of PASSOS) localStorage.removeItem(chaveCheck(e, p.id));
    force((n) => n + 1);
  }

  const auditQ = useQuery({
    enabled: canSee,
    queryKey: ["smoke_helena_audit", filtroUserEmail],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data: usrs } = await supabase
        .from("profiles")
        .select("id, email")
        .ilike("email", `%${filtroUserEmail.trim()}%`)
        .limit(10);
      const ids = (usrs ?? []).map((u: any) => u.id);
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, ts, user_id, table_name, op, pk")
        .in("user_id", ids)
        .order("ts", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  const totaisPorEmpresa = useMemo(() => {
    return EMPRESAS.map((e) => ({
      empresa: e,
      feitos: PASSOS.filter((p) => checked[e]?.[p.id]).length,
      total: PASSOS.length,
    }));
  }, [checked]);

  const totalGeral = totaisPorEmpresa.reduce((a, b) => a + b.feitos, 0);
  const totalEsperado = EMPRESAS.length * PASSOS.length;

  if (!canSee) {
    return <section className="card-elevated p-6 text-sm text-muted-foreground">Apenas administradores e controladoria podem acompanhar o smoke test.</section>;
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="Smoke Test — Helena"
        subtitle={`Roteiro guiado das 6 empresas × ${PASSOS.length} passos = ${totalEsperado} validações. ${totalGeral}/${totalEsperado} concluídos.`}
        module="Administração"
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        {/* checklist */}
        <section className="card-elevated">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              {totaisPorEmpresa.map((t) => (
                <button
                  key={t.empresa}
                  onClick={() => setEmpresaAtual(t.empresa)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                    empresaAtual === t.empresa
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card hover:bg-muted"
                  }`}
                >
                  {t.empresa}
                  <span className="ml-2 text-[10px] text-muted-foreground">{t.feitos}/{t.total}</span>
                </button>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={resetar}>Resetar marcações</Button>
          </header>
          <ol className="divide-y divide-border">
            {PASSOS.map((p) => {
              const done = !!checked[empresaAtual]?.[p.id];
              return (
                <li key={p.id} className="flex items-start gap-3 px-5 py-3.5">
                  <Checkbox
                    checked={done}
                    onCheckedChange={(v) => toggle(empresaAtual, p.id, !!v)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}>{p.titulo}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{p.esperado}</p>
                    <Link
                      to={p.rota}
                      className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> {p.rotaLabel}
                    </Link>
                  </div>
                  {done && <CheckCircle2 className="mt-1 h-4 w-4 text-emerald-500" />}
                </li>
              );
            })}
          </ol>
        </section>

        {/* audit panel */}
        <section className="card-elevated">
          <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-3.5">
            <div>
              <h2 className="font-display text-sm font-bold">Auditoria — últimos eventos</h2>
              <p className="text-xs text-muted-foreground">Atualiza a cada 15 s.</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => qc.invalidateQueries({ queryKey: ["smoke_helena_audit"] })}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </header>
          <div className="border-b border-border px-5 py-2.5">
            <Input
              placeholder="Filtrar e-mail (ex.: helena)"
              value={filtroUserEmail}
              onChange={(e) => setFiltroUserEmail(e.target.value)}
              className="h-8"
            />
          </div>
          <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
            {auditQ.isLoading && <li className="px-5 py-4 text-center text-xs text-muted-foreground">Carregando…</li>}
            {auditQ.data?.length === 0 && (
              <li className="px-5 py-4 text-center text-xs text-muted-foreground">Nenhum evento encontrado.</li>
            )}
            {auditQ.data?.map((row) => (
              <li key={row.id} className="px-5 py-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-[11px] text-muted-foreground">{row.table_name}</code>
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{row.op}</Badge>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {new Date(row.ts).toLocaleString("pt-BR")}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card-elevated p-5 text-xs text-muted-foreground">
        <h3 className="mb-2 font-display text-sm font-bold text-foreground">Critérios de aceite após executar nas 6 empresas</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Sininho disparou em todas as transições (8 × 6 = 48 notificações esperadas).</li>
          <li>Nenhuma RC travou por falta de gestor.</li>
          <li>Inbox exibe SlaChip correto (verde / âmbar / vermelho).</li>
          <li>Timeline de aprovação mostra TipoParecerBadge correto (bloqueante / consultivo / ciência).</li>
          <li>Painel Saúde de Alçadas indica zero CCs sem gestor após o teste.</li>
        </ul>
      </section>
    </div>
  );
}
