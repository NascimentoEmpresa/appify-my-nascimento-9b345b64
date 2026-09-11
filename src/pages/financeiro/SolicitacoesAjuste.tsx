import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Plus, Settings, ClipboardList, History, Clock, CheckCircle2, Archive, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SolicitacaoAjuste, STATUS_BADGE_CLASSE_SOLICITACAO_AJUSTE, STATUS_LABEL_SOLICITACAO_AJUSTE, StatusSolicitacaoAjuste,
  useContratosSolicitacaoAjuste, useSolicitacoesAjuste,
} from "@/hooks/useSolicitacaoAjuste";
import { NovaSolicitacaoModal } from "./solicitacoes-ajuste/NovaSolicitacaoModal";
import { DetalheSolicitacaoModal } from "./solicitacoes-ajuste/DetalheSolicitacaoModal";
import { GerenciarTiposModal } from "./solicitacoes-ajuste/GerenciarTiposModal";
import { HistoricoCompetenciaModal } from "./solicitacoes-ajuste/HistoricoCompetenciaModal";

const MENU_CODIGO = "financeiro-solicitacoes-ajuste";

// SIS-2026-0305: migrado do módulo "Ajustes" (aju_*) do legado Python/eel
// (Sistema Financeiro Nascimento) — mesmo app que já teve o Checklist de
// Faturamento migrado (SIS-2026-0304, ChecklistFaturamento.tsx), mesma
// estrutura de tela/precedente. Fase 1: estrutura funcional; dado histórico
// do legado migra depois, como script separado.

export default function SolicitacoesAjuste() {
  const { data: solicitacoes = [], isLoading } = useSolicitacoesAjuste();
  const { data: contratos = [] } = useContratosSolicitacaoAjuste();
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<StatusSolicitacaoAjuste | "todas" | "despacho_atrasado">("todas");
  const [novaSolAberta, setNovaSolAberta] = useState(false);
  const [tiposAberto, setTiposAberto] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [historico, setHistorico] = useState<{ contratoId: string; competencia: string; nome?: string } | null>(null);

  const hoje = new Date().toLocaleDateString("sv-SE");
  const despachoAtrasado = (s: SolicitacaoAjuste) => s.status === "enviado" && !s.data_despacho && !!s.prazo_despacho && s.prazo_despacho < hoje;

  const kpis = useMemo(() => {
    const contagem: Record<string, number> = { total: solicitacoes.length, despacho: 0 };
    for (const s of solicitacoes) {
      contagem[s.status] = (contagem[s.status] ?? 0) + 1;
      if (despachoAtrasado(s)) contagem.despacho++;
    }
    return contagem;
  }, [solicitacoes]);

  const filtradas = useMemo(() => {
    return solicitacoes.filter((s) => {
      if (filtroStatus === "despacho_atrasado" && !despachoAtrasado(s)) return false;
      if (filtroStatus !== "todas" && filtroStatus !== "despacho_atrasado" && s.status !== filtroStatus) return false;
      if (busca && !s.contrato?.nome.toLowerCase().includes(busca.toLowerCase())) return false;
      return true;
    });
  }, [solicitacoes, filtroStatus, busca]);

  const detalhe = solicitacoes.find((s) => s.id === detalheId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        module="Financeiro"
        title="Solicitações de Ajuste"
        subtitle="Pedidos de documentos/comprovantes de RH por contrato e competência."
        actions={
          <AcessoGate menu={MENU_CODIGO} acao="alterar">
            <div className="flex gap-2">
              <Button variant="outline" className="gap-1.5" onClick={() => setTiposAberto(true)}>
                <Settings className="h-4 w-4" /> Tipos
              </Button>
              <Button className="gap-1.5" onClick={() => setNovaSolAberta(true)}>
                <Plus className="h-4 w-4" /> Nova Solicitação
              </Button>
            </div>
          </AcessoGate>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <KpiTile label="Ativas" valor={String(kpis.total ?? 0)} icon={<ClipboardList />} cor="slate" onClick={() => setFiltroStatus("todas")} />
        <KpiTile label="Aguardando RH" valor={String(kpis.aguardando_rh ?? 0)} icon={<Clock />} cor="amber" onClick={() => setFiltroStatus("aguardando_rh")} />
        <KpiTile label="Em Conf. RH" valor={String(kpis.em_conferencia_rh ?? 0)} icon={<Clock />} cor="sky" onClick={() => setFiltroStatus("em_conferencia_rh")} />
        <KpiTile label="Concluído RH" valor={String(kpis.concluido_rh ?? 0)} icon={<CheckCircle2 />} cor="sky" onClick={() => setFiltroStatus("concluido_rh")} />
        <KpiTile label="Enviados" valor={String(kpis.enviado ?? 0)} icon={<CheckCircle2 />} cor="emerald" onClick={() => setFiltroStatus("enviado")} />
        <KpiTile
          label="Despacho atrasado" valor={String(kpis.despacho ?? 0)} icon={<AlertTriangle />}
          cor="red" valorClass={kpis.despacho > 0 ? "text-destructive" : undefined}
          onClick={() => setFiltroStatus("despacho_atrasado")}
        />
        <KpiTile label="Arquivadas" valor="—" icon={<Archive />} cor="slate" />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input placeholder="Buscar por contrato..." value={busca} onChange={(e) => setBusca(e.target.value)} className="max-w-xs" />
            {filtroStatus !== "todas" && (
              <Button variant="ghost" size="sm" onClick={() => setFiltroStatus("todas")}>Limpar filtro</Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Competência</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => setDetalheId(s.id)}>
                    <TableCell className="font-medium">{s.contrato?.nome ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("border", STATUS_BADGE_CLASSE_SOLICITACAO_AJUSTE[s.status])}>
                        {STATUS_LABEL_SOLICITACAO_AJUSTE[s.status]}
                      </Badge>
                      {s.iteracao > 1 && <Badge variant="secondary" className="ml-1">{s.iteracao}ª</Badge>}
                    </TableCell>
                    <TableCell>{s.competencia?.slice(0, 7)}</TableCell>
                    <TableCell className={despachoAtrasado(s) ? "text-destructive font-medium" : undefined}>
                      {s.status === "enviado" ? s.prazo_despacho ?? "—" : s.prazo_resposta ?? "—"}
                    </TableCell>
                    <TableCell>
                      {s.iteracao > 1 && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          onClick={(e) => { e.stopPropagation(); setHistorico({ contratoId: s.contrato_id, competencia: s.competencia, nome: s.contrato?.nome }); }}
                        >
                          <History className="h-3.5 w-3.5" /> Histórico
                        </button>
                      )}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                ))}
                {!isLoading && filtradas.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhuma solicitação encontrada.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <NovaSolicitacaoModal open={novaSolAberta} onOpenChange={setNovaSolAberta} contratos={contratos} />
      <GerenciarTiposModal open={tiposAberto} onOpenChange={setTiposAberto} />
      <DetalheSolicitacaoModal solicitacao={detalhe} onOpenChange={(open) => !open && setDetalheId(null)} />
      <HistoricoCompetenciaModal
        contratoId={historico?.contratoId ?? null}
        competencia={historico?.competencia ?? null}
        contratoNome={historico?.nome}
        onOpenChange={(open) => !open && setHistorico(null)}
      />
    </div>
  );
}
