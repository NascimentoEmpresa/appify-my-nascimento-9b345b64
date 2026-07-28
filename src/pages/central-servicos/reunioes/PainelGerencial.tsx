import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  ArrowLeft, CalendarClock, CheckCircle2, Clock, Download, FileWarning, ListChecks,
  MessageSquareWarning, Target, TimerOff, Users2,
} from "lucide-react";
import { usePainelGerencialDados } from "./usePainelGerencialDados";
import { useUsuariosAtivos } from "./useReunioes";
import { ETAPA_LABEL, TIPO_REUNIAO_LABEL, type ReuniaoEtapa, type TipoReuniao } from "./types";

interface Indicador {
  id: string;
  label: string;
  calculo: string;
  icon: React.ReactNode;
  num: number;
  den: number;
  polaridade: "positiva" | "negativa";
}

function statusIndicador(i: Indicador): "Bom" | "Atenção" | "Crítico" {
  const pct = i.den > 0 ? (i.num / i.den) * 100 : 0;
  if (i.polaridade === "positiva") {
    if (pct >= 80) return "Bom";
    if (pct >= 60) return "Atenção";
    return "Crítico";
  }
  if (pct <= 20) return "Bom";
  if (pct <= 40) return "Atenção";
  return "Crítico";
}

const STATUS_COR: Record<string, string> = {
  Bom: "bg-emerald-100 text-emerald-800 border-emerald-200",
  "Atenção": "bg-amber-100 text-amber-800 border-amber-200",
  "Crítico": "bg-red-100 text-red-700 border-red-200",
};

function pctIndicador(i: Indicador): number {
  return i.den > 0 ? Math.round((i.num / i.den) * 100) : 0;
}

function KpiTile({ indicador }: { indicador: Indicador }) {
  const status = statusIndicador(indicador);
  return (
    <Card className="flex items-start gap-3 p-4">
      <span className={`rounded-md p-2 ${STATUS_COR[status]}`}>{indicador.icon}</span>
      <div className="min-w-0">
        <p className="text-xl font-bold leading-tight">{pctIndicador(indicador)}%</p>
        <p className="truncate text-xs font-medium">{indicador.label}</p>
        <p className="text-xs text-muted-foreground">{indicador.num} de {indicador.den}</p>
      </div>
    </Card>
  );
}

export default function PainelGerencial() {
  const { reunioes, pauta, decisoesAcoes, assuntosForaPauta, isLoading } = usePainelGerencialDados();
  const { data: usuarios = [] } = useUsuariosAtivos();

  const [filtroLider, setFiltroLider] = useState("");
  const [filtroSetor, setFiltroSetor] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<TipoReuniao | "">("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<ReuniaoEtapa | "">("");

  const opcoesUsuarios = usuarios.map((u) => ({ value: u.id, label: u.display_name ?? "—" }));
  const setoresDisponiveis = useMemo(
    () => Array.from(new Set(reunioes.map((r) => r.setor_responsavel).filter((s): s is string => !!s))).sort(),
    [reunioes],
  );

  const limparFiltros = () => {
    setFiltroLider(""); setFiltroSetor(""); setFiltroTipo(""); setDataInicio(""); setDataFim(""); setFiltroStatus("");
  };

  const reunioesFiltradas = useMemo(() => reunioes.filter((r) =>
    (!filtroLider || r.organizador_user_id === filtroLider)
    && (!filtroSetor || r.setor_responsavel === filtroSetor)
    && (!filtroTipo || r.tipo_reuniao === filtroTipo)
    && (!dataInicio || r.data_hora >= dataInicio)
    && (!dataFim || r.data_hora <= `${dataFim}T23:59:59`)
    && (!filtroStatus || r.etapa === filtroStatus),
  ), [reunioes, filtroLider, filtroSetor, filtroTipo, dataInicio, dataFim, filtroStatus]);

  const { indicadores, tempoMedioMin } = useMemo(() => {
    const idsFiltrados = new Set(reunioesFiltradas.map((r) => r.id));
    const pautaFiltrada = pauta.filter((p) => idsFiltrados.has(p.reuniao_id));
    const pautaIdsFiltrados = new Set(pautaFiltrada.map((p) => p.id));
    const decisoesFiltradas = decisoesAcoes.filter((d) => pautaIdsFiltrados.has(d.pauta_id));
    const assuntosFiltrados = assuntosForaPauta.filter((a) => idsFiltrados.has(a.reuniao_id));

    const iniciadas = reunioesFiltradas.filter((r) => r.hora_inicio_real);
    const concluidas = reunioesFiltradas.filter((r) => r.etapa === "concluida");

    const iniciadasComPauta = iniciadas.filter((r) => pautaFiltrada.some((p) => p.reuniao_id === r.id));
    const concluidasNoTempo = concluidas.filter((r) => r.duracao_real_minutos != null && r.duracao_real_minutos <= r.duracao_minutos);
    const duracoesReais = concluidas.map((r) => r.duracao_real_minutos).filter((d): d is number => d != null);
    const tempoMedio = duracoesReais.length ? Math.round(duracoesReais.reduce((a, b) => a + b, 0) / duracoesReais.length) : null;
    const atingiramObjetivo = concluidas.filter((r) => r.checklist_encerramento?.atingiu_objetivo === "sim");
    const focadasNaPauta = concluidas.filter((r) => r.checklist_encerramento?.focada_na_pauta === "sim");
    const comAcoesDefinidas = concluidas.filter((r) => {
      const idsPautaReuniao = pautaFiltrada.filter((p) => p.reuniao_id === r.id).map((p) => p.id);
      return decisoesFiltradas.some((d) => d.tipo === "acao" && idsPautaReuniao.includes(d.pauta_id));
    });
    const comDebateImprodutivo = concluidas.filter((r) => r.checklist_encerramento?.debates_improdutivos === "sim_relevante");
    const acoesComPrazo = decisoesFiltradas.filter((d) => d.tipo === "acao" && d.prazo);
    const hoje = new Date().toISOString().slice(0, 10);
    const acoesVencidas = acoesComPrazo.filter((d) => (d.prazo as string) < hoje && d.status !== "concluida");
    const estacionados = assuntosFiltrados.filter((a) => a.tratativa === "estacionar");
    const estacionadosPendentes = estacionados.filter((a) => !a.concluido);
    const inconclusivas = concluidas.filter((r) => {
      const objetivoParcialOuNao = r.checklist_encerramento?.atingiu_objetivo === "parcialmente" || r.checklist_encerramento?.atingiu_objetivo === "nao";
      const pautaPendente = pautaFiltrada.some((p) => p.reuniao_id === r.id && p.status !== "concluida");
      return objetivoParcialOuNao || pautaPendente;
    });

    const lista: Indicador[] = [
      { id: "iniciadas_pauta", label: "Reuniões iniciadas com pauta", calculo: "Reuniões com pauta ÷ reuniões realizadas.", icon: <ListChecks className="h-5 w-5" />, num: iniciadasComPauta.length, den: iniciadas.length, polaridade: "positiva" },
      { id: "dentro_tempo", label: "Reuniões concluídas dentro do tempo", calculo: "Duração real ≤ prevista ÷ reuniões concluídas.", icon: <Clock className="h-5 w-5" />, num: concluidasNoTempo.length, den: concluidas.length, polaridade: "positiva" },
      { id: "objetivo", label: "Reuniões que atingiram o objetivo", calculo: "Respostas \"Sim\" ÷ reuniões concluídas.", icon: <Target className="h-5 w-5" />, num: atingiramObjetivo.length, den: concluidas.length, polaridade: "positiva" },
      { id: "focadas_pauta", label: "Reuniões focadas na pauta", calculo: "Respostas \"Sim\" ÷ reuniões concluídas.", icon: <CheckCircle2 className="h-5 w-5" />, num: focadasNaPauta.length, den: concluidas.length, polaridade: "positiva" },
      { id: "acoes_definidas", label: "Reuniões com ações definidas", calculo: "Reuniões com ao menos 1 ação ÷ concluídas.", icon: <Users2 className="h-5 w-5" />, num: comAcoesDefinidas.length, den: concluidas.length, polaridade: "positiva" },
      { id: "debate_improdutivo", label: "Reuniões com debate improdutivo relevante", calculo: "Respostas correspondentes ÷ reuniões concluídas.", icon: <MessageSquareWarning className="h-5 w-5" />, num: comDebateImprodutivo.length, den: concluidas.length, polaridade: "negativa" },
      { id: "acoes_vencidas", label: "Ações vencidas", calculo: "Ações com prazo vencido e não concluídas ÷ ações com prazo.", icon: <TimerOff className="h-5 w-5" />, num: acoesVencidas.length, den: acoesComPrazo.length, polaridade: "negativa" },
      { id: "assuntos_pendentes", label: "Assuntos estacionados pendentes", calculo: "Sem tratativa concluída ÷ assuntos estacionados.", icon: <FileWarning className="h-5 w-5" />, num: estacionadosPendentes.length, den: estacionados.length, polaridade: "negativa" },
      { id: "inconclusivas", label: "Reuniões inconclusivas", calculo: "Objetivo \"Parcialmente/Não\" ou pauta pendente ÷ concluídas.", icon: <CalendarClock className="h-5 w-5" />, num: inconclusivas.length, den: concluidas.length, polaridade: "negativa" },
    ];

    return { indicadores: lista, tempoMedioMin: tempoMedio };
  }, [reunioesFiltradas, pauta, decisoesAcoes, assuntosForaPauta]);

  const exportarCsv = () => {
    const linhas = [
      ["Indicador", "Cálculo/Origem", "Detalhes", "Percentual", "Status"],
      ...indicadores.map((i) => [i.label, i.calculo, `${i.num} de ${i.den}`, `${pctIndicador(i)}%`, statusIndicador(i)]),
    ];
    if (tempoMedioMin !== null) {
      linhas.push(["Tempo médio por tipo de reunião", "Média da duração real.", `${Math.floor(tempoMedioMin / 60)}h ${tempoMedioMin % 60}min`, "—", "—"]);
    }
    const csv = linhas.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "painel-gerencial-reunioes.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Painel gerencial"
        module="Central de Serviços"
        breadcrumb={["Agenda de Reunião", "Painel gerencial"]}
        subtitle="Acompanhe os indicadores gerenciais das suas reuniões."
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportarCsv}>
              <Download className="h-3.5 w-3.5" /> Exportar
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/app/central-servicos/reunioes"><ArrowLeft className="mr-1 h-4 w-4" /> Voltar</Link>
            </Button>
          </>
        }
      />

      <Card className="flex flex-wrap items-end gap-2 p-4">
        <div className="w-48 space-y-1">
          <p className="text-xs text-muted-foreground">Líder</p>
          <SearchableSelect value={filtroLider} onChange={setFiltroLider} options={opcoesUsuarios} placeholder="Todos" allowClear clearValue="" />
        </div>
        <div className="w-44 space-y-1">
          <p className="text-xs text-muted-foreground">Setor</p>
          <Select value={filtroSetor || "todos"} onValueChange={(v) => setFiltroSetor(v === "todos" ? "" : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {setoresDisponiveis.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-44 space-y-1">
          <p className="text-xs text-muted-foreground">Tipo de reunião</p>
          <Select value={filtroTipo || "todos"} onValueChange={(v) => setFiltroTipo(v === "todos" ? "" : v as TipoReuniao)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {(Object.keys(TIPO_REUNIAO_LABEL) as TipoReuniao[]).map((t) => <SelectItem key={t} value={t}>{TIPO_REUNIAO_LABEL[t]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Período</p>
          <div className="flex items-center gap-1">
            <Input type="date" className="w-36" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            <span className="text-xs text-muted-foreground">a</span>
            <Input type="date" className="w-36" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
        </div>
        <div className="w-40 space-y-1">
          <p className="text-xs text-muted-foreground">Status</p>
          <Select value={filtroStatus || "todos"} onValueChange={(v) => setFiltroStatus(v === "todos" ? "" : v as ReuniaoEtapa)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {(Object.keys(ETAPA_LABEL) as ReuniaoEtapa[]).map((e) => <SelectItem key={e} value={e}>{ETAPA_LABEL[e]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="ghost" size="sm" onClick={limparFiltros}>Limpar filtros</Button>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {!isLoading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {indicadores.slice(0, 2).map((i) => <KpiTile key={i.id} indicador={i} />)}
            <Card className="flex items-start gap-3 p-4">
              <span className="rounded-md bg-blue-100 p-2 text-blue-700"><Clock className="h-5 w-5" /></span>
              <div>
                <p className="text-xl font-bold leading-tight">
                  {tempoMedioMin !== null ? `${Math.floor(tempoMedioMin / 60)}h ${tempoMedioMin % 60}min` : "—"}
                </p>
                <p className="text-xs font-medium">Tempo médio por reunião</p>
                <p className="text-xs text-muted-foreground">Média geral</p>
              </div>
            </Card>
            {indicadores.slice(2).map((i) => <KpiTile key={i.id} indicador={i} />)}
          </div>

          <Card className="overflow-x-auto p-4">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-2">Indicador</th>
                  <th className="py-2 pr-2">Cálculo / Origem</th>
                  <th className="py-2 pr-2">Detalhes</th>
                  <th className="py-2 pr-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {indicadores.map((i) => {
                  const pct = pctIndicador(i);
                  const status = statusIndicador(i);
                  return (
                    <tr key={i.id} className="border-b border-border last:border-b-0">
                      <td className="py-2 pr-2 font-medium">{i.label}</td>
                      <td className="py-2 pr-2 text-xs text-muted-foreground">{i.calculo}</td>
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{i.num} de {i.den} · {pct}%</span>
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        <Badge variant="outline" className={STATUS_COR[status]}>{status}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <p className="text-xs text-muted-foreground">
            Indicadores calculados a partir das suas reuniões (onde você é criador, organizador, responsável, convidado ou observador). Atualiza automaticamente conforme o registro das reuniões, ações e prazos.
          </p>
        </>
      )}
    </div>
  );
}
