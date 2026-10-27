import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarCheck, CheckCircle2, ClipboardList, Clock, GraduationCap, Loader2, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useSolicitacoesTreinamento } from "@/hooks/useSolicitacoesTreinamento";
import { DetalheSolicitacaoTreinamento } from "@/components/treinamentos/DetalheSolicitacaoTreinamento";
import { MODALIDADES, STATUS_SOL_TREINAMENTO, ordenarFila, rotuloStatus, type StatusSolTreinamento } from "@/lib/treinamentos/solicitacaoTreinamento";

// =====================================================================
// TREINAMENTOS › SOLICITAÇÕES DE TREINAMENTOS (mig 20261026000910, 26/10/2026)
//
// O outro lado do "Solicitar Treinamento" dos encarregados: a fila do setor
// de Treinamentos. Prioritários pendentes primeiro, depois pela data
// prevista. Quem tem "aprovar" em treinamentos_solicitacoes aprova (com ou
// sem data), devolve para ajuste, reprova, agenda, marca como realizado ou
// cancela; todos conversam com o encarregado e copiam a ficha para o ofício.
// =====================================================================

type Filtro = "pendente" | "andamento" | "concluida" | "encerradas" | "todas";
const fmtData = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—");

export default function SolicitacoesTreinamento() {
  const [params, setParams] = useSearchParams();
  const lista = useSolicitacoesTreinamento();
  const podeDecidir = useScreenAccess("treinamentos_solicitacoes", "aprovar").data === true;
  const [filtro, setFiltro] = useState<Filtro>("pendente");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<number | null>(null);

  useEffect(() => { const s = Number(params.get("s")); if (s) setAberta(s); }, [params]);

  const todas = useMemo(() => lista.data ?? [], [lista.data]);
  const grupo = (st: StatusSolTreinamento): Filtro =>
    st === "pendente" ? "pendente" : st === "aprovada" || st === "agendada" ? "andamento" : st === "concluida" ? "concluida" : "encerradas";
  const contagem = (f: Filtro) => (f === "todas" ? todas.length : todas.filter((s) => grupo(s.status) === f).length);
  const prioritarias = todas.filter((s) => s.status === "pendente" && s.urgencia === "prioritario").length;
  const participantes = todas.filter((s) => grupo(s.status) === "andamento").reduce((a, s) => a + s.qtd_participantes, 0);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return ordenarFila(todas.filter((s) => (filtro === "todas" || grupo(s.status) === filtro)
      && (!t || [s.protocolo, s.treinamento, s.contrato_nome, s.solicitante_nome, s.equipe].some((v) => String(v ?? "").toLowerCase().includes(t)))));
  }, [todas, filtro, busca]);

  const sol = todas.find((s) => s.id === aberta) ?? null;
  const fechar = () => { setAberta(null); if (params.get("s")) { params.delete("s"); setParams(params, { replace: true }); } };

  return (
    <div className="space-y-4">
      <PageHeader title="Solicitações de Treinamentos" module="Treinamentos" breadcrumb={["Solicitações de Treinamentos"]}
        subtitle="Pedidos dos encarregados com todas as informações para organizar o treinamento: aprove, agende, devolva para ajuste ou reprove." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icone={Clock} rotulo="Aguardando análise" valor={contagem("pendente")} cor="text-amber-600 bg-amber-50" />
        <Kpi icone={AlertTriangle} rotulo="Prioritárias pendentes" valor={prioritarias} cor="text-red-600 bg-red-50" />
        <Kpi icone={CalendarCheck} rotulo="Aprovadas / agendadas" valor={contagem("andamento")} dica={`${participantes} participante(s)`} cor="text-indigo-600 bg-indigo-50" />
        <Kpi icone={CheckCircle2} rotulo="Realizadas" valor={contagem("concluida")} cor="text-emerald-600 bg-emerald-50" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="pendente">Aguardando ({contagem("pendente")})</TabsTrigger>
            <TabsTrigger value="andamento">Aprovadas e agendadas ({contagem("andamento")})</TabsTrigger>
            <TabsTrigger value="concluida">Realizadas ({contagem("concluida")})</TabsTrigger>
            <TabsTrigger value="encerradas">Reprovadas e canceladas ({contagem("encerradas")})</TabsTrigger>
            <TabsTrigger value="todas">Todas ({contagem("todas")})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar protocolo, treinamento, contrato…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      <Card className="overflow-x-auto">
        {lista.isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
        ) : lista.error ? (
          <div className="p-6 text-sm text-red-600">{(lista.error as Error).message}</div>
        ) : visiveis.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground"><GraduationCap className="mx-auto mb-2 h-8 w-8 opacity-40" /> Nenhuma solicitação aqui.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Protocolo</TableHead>
                <TableHead>Treinamento</TableHead>
                <TableHead className="hidden lg:table-cell">Solicitante</TableHead>
                <TableHead className="text-right">Particip.</TableHead>
                <TableHead>Data prevista</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => setAberta(s.id)}>
                  <TableCell className="text-xs text-muted-foreground">{s.protocolo}<div>{new Date(s.created_at).toLocaleDateString("pt-BR")}</div></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 font-medium">
                      {s.urgencia === "prioritario" && <Badge variant="outline" className="border-red-200 bg-red-50 px-1.5 py-0 text-[10px] text-red-700">Prioritário</Badge>}
                      {s.treinamento}
                    </div>
                    <div className="text-xs text-muted-foreground">{s.contrato_nome} · {MODALIDADES.find((m) => m.v === s.modalidade)?.r}</div>
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{s.solicitante_nome ?? "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{s.qtd_participantes}</TableCell>
                  <TableCell className="text-sm">
                    {s.data_confirmada ? <span className="font-semibold text-indigo-700">{fmtData(s.data_confirmada)}</span> : fmtData(s.data_preferencial)}
                    <div className="text-xs text-muted-foreground">{s.data_confirmada ? s.horario_confirmado ?? "" : `${(s.horario_inicio ?? "").slice(0, 5)}–${(s.horario_fim ?? "").slice(0, 5)}`}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("font-semibold", s.status === "pendente" && s.devolucao_motivo ? "border-orange-300 bg-orange-100 text-orange-800" : STATUS_SOL_TREINAMENTO[s.status].cor)}>
                      {rotuloStatus(s)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {!podeDecidir && todas.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ClipboardList className="h-3.5 w-3.5" /> Você acompanha e conversa; aprovar e reprovar pede "aprovar" em Solicitações de Treinamentos.</p>
      )}
      <DetalheSolicitacaoTreinamento solicitacao={sol} lado="treinamentos" podeDecidir={podeDecidir} onFechar={fechar} />
    </div>
  );
}

function Kpi({ icone: I, rotulo, valor, dica, cor }: { icone: typeof Clock; rotulo: string; valor: number; dica?: string; cor: string }) {
  return (
    <Card className="flex items-center gap-3 p-3">
      <span className={cn("inline-flex h-10 w-10 items-center justify-center rounded-xl", cor)}><I className="h-5 w-5" /></span>
      <div><div className="text-xl font-bold leading-none">{valor}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{rotulo}</div>
        {dica && <div className="text-[10px] text-muted-foreground">{dica}</div>}</div>
    </Card>
  );
}
