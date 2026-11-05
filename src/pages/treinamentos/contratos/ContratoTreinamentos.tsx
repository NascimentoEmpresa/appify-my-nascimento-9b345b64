import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, ChevronRight, ClipboardCheck, GraduationCap, Loader2, Plus, Star, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useContratosTreinamento, useDadosTreinamentos, useTreinamentosContrato } from "@/hooks/useTreinamentosContrato";
import { calcularIndicadores, fmtDataBr, fmtHora, fmtNota, fmtPct, siglaEmpresa } from "@/lib/treinamentos/contratoTreinamento";
import { Kpi, MENU_TRN_CONTRATOS, TreinamentoFormDialog } from "./componentes";

// Contrato → lista dos treinamentos realizados nele (mig 20261104006000).
export default function ContratoTreinamentos() {
  const nav = useNavigate();
  const { empresa: e, filial: f } = useParams();
  const empresa = Number(e); const filial = Number(f);
  const contratos = useContratosTreinamento(empresa);
  const contrato = (contratos.data ?? []).find((c) => c.filial === filial);
  const lista = useTreinamentosContrato({ empresa, filial });
  const ids = useMemo(() => (lista.data ?? []).map((t) => t.id), [lista.data]);
  const dados = useDadosTreinamentos(ids);
  const [novo, setNovo] = useState(false);

  const nome = contrato?.nome ?? lista.data?.[0]?.contrato_nome ?? `Filial ${filial}`;
  const porTreino = useMemo(() => {
    const m = new Map<number, ReturnType<typeof calcularIndicadores>>();
    for (const id of ids) {
      m.set(id, calcularIndicadores({
        participantes: (dados.data?.participantes ?? []).filter((p) => p.treinamento_id === id),
        avaliacoes: (dados.data?.avaliacoes ?? []).filter((a) => a.treinamento_id === id),
        satisfacao: (dados.data?.satisfacao ?? []).filter((s) => s.treinamento_id === id),
      }));
    }
    return m;
  }, [ids, dados.data]);
  const geral = calcularIndicadores({
    participantes: dados.data?.participantes ?? [], avaliacoes: dados.data?.avaliacoes ?? [], satisfacao: dados.data?.satisfacao ?? [],
  });

  return (
    <div className="space-y-4">
      <PageHeader title={nome} module="Treinamentos" breadcrumb={["Treinamentos por Contrato", siglaEmpresa(empresa), nome]}
        subtitle={`${siglaEmpresa(empresa)} · filial ${filial}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link to={`/app/treinamentos/contratos?empresa=${empresa}`}><ArrowLeft className="mr-2 h-4 w-4" />Contratos</Link></Button>
            <AcessoGate menu={MENU_TRN_CONTRATOS} acao="incluir">
              <Button onClick={() => setNovo(true)}><Plus className="mr-2 h-4 w-4" />Registrar treinamento</Button>
            </AcessoGate>
          </div>
        } />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icone={GraduationCap} rotulo="Treinamentos" valor={ids.length} cor="bg-indigo-50 text-indigo-600" />
        <Kpi icone={Users} rotulo="Presença" valor={fmtPct(geral.taxaPresenca)} dica={`${geral.presentes} de ${geral.participantes}`} cor="bg-emerald-50 text-emerald-600" />
        <Kpi icone={ClipboardCheck} rotulo="Nota média" valor={fmtNota(geral.notaMedia)} dica={`aprovação ${fmtPct(geral.taxaAprovacao)}`} cor="bg-amber-50 text-amber-600" />
        <Kpi icone={Star} rotulo="Satisfação (0–10)" valor={fmtNota(geral.satisfacaoMedia)} dica={`${geral.respostasSatisfacao} resposta(s)`} cor="bg-pink-50 text-pink-600" />
      </div>

      <div className="rounded-xl border bg-card">
        {lista.isLoading ? (
          <div className="flex items-center justify-center p-10 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando…</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Data</TableHead>
                <TableHead>Treinamento</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead className="text-right">Presentes</TableHead>
                <TableHead className="text-right">Nota média</TableHead>
                <TableHead className="text-right">Satisfação</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(lista.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  <CalendarDays className="mx-auto mb-2 h-6 w-6" />Nenhum treinamento registrado neste contrato.
                </TableCell></TableRow>
              )}
              {(lista.data ?? []).map((t) => {
                const i = porTreino.get(t.id);
                return (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => nav(`/app/treinamentos/contratos/treinamento/${t.id}`)}>
                    <TableCell>{fmtDataBr(t.data)}<div className="text-[11px] text-muted-foreground">{[fmtHora(t.horario_inicio), fmtHora(t.horario_fim)].filter(Boolean).join("–")}</div></TableCell>
                    <TableCell className="font-medium">{t.nome}{t.tema && <div className="text-xs font-normal text-muted-foreground">{t.tema}</div>}</TableCell>
                    <TableCell>{t.responsavel ?? "—"}</TableCell>
                    <TableCell className="text-right">{i ? `${i.presentes}/${i.participantes}` : "—"}</TableCell>
                    <TableCell className="text-right">{fmtNota(i?.notaMedia)}</TableCell>
                    <TableCell className="text-right">{fmtNota(i?.satisfacaoMedia)}</TableCell>
                    <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <TreinamentoFormDialog aberto={novo} onFechar={() => setNovo(false)} contrato={{ empresa, filial, nome }}
        onSalvo={(id) => nav(`/app/treinamentos/contratos/treinamento/${id}`)} />
    </div>
  );
}
