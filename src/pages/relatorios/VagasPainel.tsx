import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowLeft, ArrowUpDown, Briefcase, CheckCircle2, Clock, Hourglass, Info, Loader2, Search, ShieldAlert, Timer, Users, XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useVagaDetalhe, useVagasPainel } from "@/hooks/useRelatoriosDiretoria";
import { PASSOS_FLUXO, estadosDosPassos, statusAntesDoFim } from "@/lib/recrutamento/fluxoStatus";
import {
  DIMENSOES, ETAPAS, FILTRO_LOCAL_PADRAO, META_DIAS_CONTRATAR, agingAbertas, agruparVagas, aplicarFiltroLocal, corDias, desfechoVaga,
  diasEntreMs, diasNoStatus, diasPorEtapa, diasTotais, etapaDoStatus, fmtDias, funilVagas, mensalVagas, opcoesDe, resumoVagas, tempoAprovacao,
  tempoPorEtapa, tituloEtapa, trechosDaVaga, vagaFechada,
  type Dimensao, type FiltroLocal, type LinhaEtapa, type PainelVagas, type VagaPainel,
} from "@/lib/relatorios/vagasPainel";
import { rotuloMes, type Kpi } from "./sistemas";
import { LinhaKpis, SeletorPeriodo, usePeriodo } from "./componentes";

// =====================================================================
// RELATÓRIOS › VAGAS — DASHBOARD (mig 20261007000020, 07/10/2026)
//
// Pedido do Pablo: "Vagas dashboard … até dashboards POR VAGA solicitada,
// quanto tempo ficou em cada vaga etc, bem completo". Quatro abas:
//   · Visão geral — KPIs, mês a mês (coorte da solicitação), funil,
//     desfecho, aging das abertas e rankings por contrato/cargo/cidade/…;
//   · Tempo por etapa — média/mediana/maior em cada um dos 8 passos do
//     fluxo (fluxoStatus.ts) e quantas estão paradas em cada um agora;
//   · Em aberto agora — todas as abertas (mesmo as pedidas antes do
//     período), da mais antiga para a mais nova;
//   · Todas as vagas — uma linha por vaga com a barra do tempo em cada
//     etapa; clicar abre o dashboard da vaga (trechos, comparação com a
//     média, candidatos e a trilha completa).
// Contas em src/lib/relatorios/vagasPainel.ts (com teste).
// =====================================================================

const COR_ETAPA: Record<string, string> = {
  aprovacao: "#94a3b8", recrutamento: "#7c3aed", selecao: "#2563eb", juridico: "#0891b2", entrevistas: "#db2777",
  aprovado: "#ea580c", sst_compras: "#f59e0b", contratado: "#16a34a", outros: "#64748b", legado: "#a8a29e",
};
const COR_DESFECHO = { contratada: "#16a34a", andamento: "#f59e0b", reprovada: "#dc2626", cancelada: "#6b7280" };
const ROTULO_DESFECHO = { contratada: "Contratada", andamento: "Em andamento", reprovada: "Reprovada", cancelada: "Cancelada" };
const fmtData = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—");
const fmtDataHora = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const n1 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 10) / 10);
const tituloVaga = (v: Pick<VagaPainel, "id" | "cargo">) => `#${v.id} · ${v.cargo ?? "Vaga"}`;

export default function VagasPainel() {
  const periodo = usePeriodo();
  const q = useVagasPainel(periodo.filtro);
  const [filtro, setFiltro] = useState<FiltroLocal>(FILTRO_LOCAL_PADRAO);
  const [aba, setAba] = useState("geral");
  const [sel, setSel] = useState<VagaPainel | null>(null);

  const bruto = q.data;
  const p = useMemo(() => (bruto ? aplicarFiltroLocal(bruto, filtro) : undefined), [bruto, filtro]);
  const etapas = useMemo(() => (p ? tempoPorEtapa(p) : []), [p]);

  return (
    <div className="space-y-4">
      <PageHeader title="Vagas — Dashboard" subtitle="Cada vaga solicitada: quanto tempo em cada etapa, gargalos, funil e desfecho" module="Relatórios" breadcrumb={["Vagas — Dashboard"]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/relatorios" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Relatório Geral
        </Link>
        <SeletorPeriodo periodo={periodo} />
      </div>

      <FiltrosLocais bruto={bruto} filtro={filtro} onChange={setFiltro} />

      {q.isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Montando o painel de vagas…</Card>
      ) : q.error || !p ? (
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><ShieldAlert className="h-5 w-5 text-warning" /> {(q.error as Error)?.message ?? "Não foi possível carregar."}</Card>
      ) : (
        <Tabs value={aba} onValueChange={setAba}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="geral">Visão geral</TabsTrigger>
            <TabsTrigger value="etapas">Tempo por etapa</TabsTrigger>
            <TabsTrigger value="abertas">Em aberto agora</TabsTrigger>
            <TabsTrigger value="vagas">Todas as vagas</TabsTrigger>
          </TabsList>
          <TabsContent value="geral" className="space-y-4"><AbaGeral p={p} meses={periodo.meses} /></TabsContent>
          <TabsContent value="etapas" className="space-y-4"><AbaEtapas p={p} etapas={etapas} /></TabsContent>
          <TabsContent value="abertas" className="space-y-4"><AbaAbertas p={p} onAbrir={setSel} /></TabsContent>
          <TabsContent value="vagas" className="space-y-4"><AbaVagas p={p} onAbrir={setSel} /></TabsContent>
        </Tabs>
      )}

      {p && <DashboardVaga vaga={sel} painel={p} etapas={etapas} onClose={() => setSel(null)} />}
    </div>
  );
}

// ---- Filtros da tela (por cima do período/contrato) -----------------------------

function FiltrosLocais({ bruto, filtro, onChange }: { bruto?: PainelVagas; filtro: FiltroLocal; onChange: (f: FiltroLocal) => void }) {
  const motivos = useMemo(() => opcoesDe(bruto, (v) => v.motivo), [bruto]);
  const urgencias = useMemo(() => opcoesDe(bruto, (v) => v.urgencia), [bruto]);
  const set = (o: Partial<FiltroLocal>) => onChange({ ...filtro, ...o });
  const ativo = filtro.busca || filtro.fase !== "todas" || filtro.motivo || filtro.urgencia || !filtro.legado;
  return (
    <Card className="flex flex-wrap items-center gap-2 p-3">
      <div className="relative">
        <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
        <Input value={filtro.busca} onChange={(e) => set({ busca: e.target.value })} placeholder="Nº, cargo, contrato, cidade, solicitante…" className="h-8 w-72 pl-8 text-xs" />
      </div>
      <Select value={filtro.fase} onValueChange={(v) => set({ fase: v as FiltroLocal["fase"] })}>
        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="todas">Todos os desfechos</SelectItem>
          {(Object.keys(ROTULO_DESFECHO) as (keyof typeof ROTULO_DESFECHO)[]).map((k) => <SelectItem key={k} value={k}>{ROTULO_DESFECHO[k]}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filtro.motivo ?? "*"} onValueChange={(v) => set({ motivo: v === "*" ? null : v })}>
        <SelectTrigger className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="*">Todos os motivos</SelectItem>
          {motivos.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filtro.urgencia ?? "*"} onValueChange={(v) => set({ urgencia: v === "*" ? null : v })}>
        <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="*">Todas as urgências</SelectItem>
          {urgencias.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch checked={filtro.legado} onCheckedChange={(c) => set({ legado: c })} /> Incluir sistema antigo (Discord)
      </label>
      {ativo && <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => onChange(FILTRO_LOCAL_PADRAO)}>Limpar</Button>}
    </Card>
  );
}

// ---- Visão geral ------------------------------------------------------------------

function AbaGeral({ p, meses }: { p: PainelVagas; meses: number[] | null }) {
  const r = useMemo(() => resumoVagas(p), [p]);
  const mensal = useMemo(() => mensalVagas(p).filter((m) => !meses || m.solicitadas > 0).map((m) => ({ ...m, rotulo: rotuloMes(m.mes), tempoMedio: n1(m.tempoMedio) })), [p, meses]);
  const funil = useMemo(() => funilVagas(p), [p]);
  const aging = useMemo(() => agingAbertas(p), [p]);
  const desfechos = useMemo(() => {
    const c = { contratada: 0, andamento: 0, reprovada: 0, cancelada: 0 };
    for (const v of p.vagas) if (v.no_periodo) c[desfechoVaga(v)]++;
    return (Object.keys(c) as (keyof typeof c)[]).filter((k) => c[k] > 0).map((k) => ({ nome: ROTULO_DESFECHO[k], n: c[k], cor: COR_DESFECHO[k] }));
  }, [p]);
  const porUrgencia = useMemo(() => agruparVagas(p, "urgencia").filter((g) => g.tempoMedioContratar != null)
    .map((g) => ({ nome: g.nome, dias: n1(g.tempoMedioContratar), n: g.contratadas })), [p]);

  const kpis: Kpi[] = [
    { rotulo: "Vagas solicitadas", valor: r.solicitadas, formato: "n", tom: "primary", dica: `${r.posicoes.toLocaleString("pt-BR")} posições (soma das quantidades)` },
    { rotulo: "Contratadas", valor: r.contratadas, formato: "n", tom: "success", dica: r.aproveitamentoPct != null ? `${r.aproveitamentoPct.toFixed(0)}% das que já fecharam` : null },
    { rotulo: "Reprovadas / canceladas", valor: r.reprovadas + r.canceladas, formato: "n", tom: "destructive" },
    { rotulo: "Em aberto agora", valor: r.abertasAgora, formato: "n", tom: "warning", dica: `${r.posicoesAbertasAgora} posições · inclui pedidas antes do período` },
    { rotulo: "Tempo médio até contratar", valor: n1(r.tempoMedioContratar), formato: "dias", tom: "info", dica: `Mediana ${fmtDias(r.medianaContratar)} · pedido → Contratado` },
    { rotulo: `Contratadas em até ${META_DIAS_CONTRATAR} dias`, valor: r.noPrazoPct != null ? n1(r.noPrazoPct) : null, formato: "pct", tom: (r.noPrazoPct ?? 0) >= 70 ? "success" : "warning" },
    { rotulo: "Tempo médio de aprovação", valor: n1(r.tempoMedioAprovacao), formato: "dias", tom: "primary", dica: "Pedido → liberado ao Recrutamento" },
    { rotulo: "Candidatos por vaga", valor: n1(r.candidatosPorVaga), formato: "n", tom: "info", dica: "Média, só vagas do sistema novo" },
    { rotulo: "Desistências de candidatos", valor: r.desistencias, formato: "n", tom: "destructive" },
    { rotulo: "Aberta mais antiga", valor: r.abertaMaisAntiga ? Math.floor(diasTotais(r.abertaMaisAntiga, p.agora)) : null, formato: "dias", tom: "warning", dica: r.abertaMaisAntiga ? tituloVaga(r.abertaMaisAntiga) : null },
  ];

  return (
    <>
      <LinhaKpis kpis={kpis} />
      {r.legado > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5" /> {r.legado} vaga(s) do sistema antigo (Discord) no período: entram no tempo total, mas não têm o tempo por etapa (o log de etapas começou em {fmtData(p.log_desde)}).
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <p className="mb-1 text-sm font-semibold">Mês a mês — pelas vagas pedidas no mês</p>
          <p className="mb-2 text-[11px] text-muted-foreground">Das solicitadas em cada mês, quantas já foram contratadas, reprovadas ou seguem em andamento; a linha é o tempo médio até contratar.</p>
          <ResponsiveContainer width="100%" height={290}>
            <ComposedChart data={mensal} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="n" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis yAxisId="d" orientation="right" tick={{ fontSize: 11 }} unit=" d" />
              <Tooltip formatter={(v: number, k: string) => (k === "Tempo médio (dias)" ? fmtDias(v) : v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="n" dataKey="contratadas" name="Contratadas" stackId="a" fill={COR_DESFECHO.contratada} />
              <Bar yAxisId="n" dataKey="andamento" name="Em andamento" stackId="a" fill={COR_DESFECHO.andamento} />
              <Bar yAxisId="n" dataKey="reprovadas" name="Reprovadas/canceladas" stackId="a" fill={COR_DESFECHO.reprovada} radius={[3, 3, 0, 0]} />
              <Line yAxisId="d" dataKey="tempoMedio" name="Tempo médio (dias)" stroke="#1d4ed8" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold">Funil das vagas do período</p>
          <div className="space-y-2.5">
            {funil.map((d, i) => (
              <div key={d.chave}>
                <div className="mb-0.5 flex items-center justify-between text-xs">
                  <span className="font-medium">{d.titulo}</span>
                  <span className="tabular-nums text-muted-foreground"><b className="text-foreground">{d.n.toLocaleString("pt-BR")}</b> · {d.pct.toFixed(0)}%</span>
                </div>
                <div className="h-5 overflow-hidden rounded bg-muted">
                  <div className="h-full rounded" style={{ width: `${Math.max(d.pct, d.n ? 2 : 0)}%`, background: i === funil.length - 1 ? "#16a34a" : `hsl(217 91% ${40 + i * 7}%)` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">"Até onde chegou": uma vaga reprovada na entrevista conta em Aprovadas, Abertas e Em entrevistas.</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">Desfecho das vagas do período</p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={desfechos} dataKey="n" nameKey="nome" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {desfechos.map((d) => <Cell key={d.nome} fill={d.cor} />)}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">Abertas agora — há quanto tempo</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={aging} margin={{ top: 16, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip formatter={(v: number, k: string) => [v, k === "vagas" ? "Vagas" : k]} />
              <Bar dataKey="vagas" name="vagas" radius={[3, 3, 0, 0]}>
                {aging.map((a) => <Cell key={a.rotulo} fill={a.cor} />)}
                <LabelList dataKey="vagas" position="top" fontSize={11} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">Tempo até contratar por urgência</p>
          {porUrgencia.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={porUrgencia} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="nome" width={130} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => fmtDias(v)} />
                <Bar dataKey="dias" fill="#2563eb" radius={[0, 3, 3, 0]}>
                  <LabelList dataKey="dias" position="right" fontSize={11} formatter={(v: number) => fmtDias(v)} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <SemDados />}
        </Card>
      </div>

      <TabelaGrupos p={p} />
    </>
  );
}

type ColGrupo = "nome" | "vagas" | "abertas" | "contratadas" | "reprovadas" | "tempoMedioContratar" | "mediaDiasAbertas";

function TabelaGrupos({ p }: { p: PainelVagas }) {
  const [dim, setDim] = useState<Dimensao>("contrato");
  const [ord, setOrd] = useState<{ col: ColGrupo; desc: boolean }>({ col: "vagas", desc: true });
  const [todos, setTodos] = useState(false);
  const linhas = useMemo(() => {
    const ls = agruparVagas(p, dim);
    const val = (l: (typeof ls)[number]) => l[ord.col] ?? -1;
    return [...ls].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === "string" ? String(x).localeCompare(String(y), "pt-BR") : (x as number) - (y as number);
      return ord.desc ? -c : c;
    });
  }, [p, dim, ord]);
  const visiveis = todos ? linhas : linhas.slice(0, 15);
  const Th = ({ col, children, className = "" }: { col: ColGrupo; children: ReactNode; className?: string }) => (
    <th className={`cursor-pointer select-none px-3 py-2 font-semibold hover:text-foreground ${className}`} onClick={() => setOrd((o) => ({ col, desc: o.col === col ? !o.desc : col !== "nome" }))}>
      <span className="inline-flex items-center gap-1">{children}{ord.col === col && <ArrowUpDown className="h-3 w-3" />}</span>
    </th>
  );
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <p className="mr-auto text-sm font-semibold">Vagas por {DIMENSOES[dim].titulo.toLowerCase()}</p>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(DIMENSOES) as Dimensao[]).map((d) => (
            <Button key={d} size="sm" variant={dim === d ? "default" : "outline"} className="h-7 text-xs" onClick={() => setDim(d)}>{DIMENSOES[d].titulo}</Button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <Th col="nome">{DIMENSOES[dim].titulo}</Th>
            <Th col="vagas" className="text-right">Solicitadas</Th>
            <Th col="contratadas" className="text-right">Contratadas</Th>
            <Th col="reprovadas" className="text-right">Reprov./canc.</Th>
            <Th col="abertas" className="text-right">Abertas agora</Th>
            <Th col="tempoMedioContratar" className="text-right">Tempo médio p/ contratar</Th>
            <Th col="mediaDiasAbertas" className="text-right">Abertas há (média)</Th>
          </tr></thead>
          <tbody>
            {visiveis.map((l) => (
              <tr key={l.nome} className="border-t border-border/60">
                <td className="max-w-[280px] truncate px-3 py-1.5 font-medium" title={l.nome}>{l.nome}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{l.vagas}{l.posicoes > l.vagas && <span className="text-muted-foreground"> ({l.posicoes} pos.)</span>}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-success">{l.contratadas || "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-destructive">{l.reprovadas || "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{l.abertas ? <b className="text-warning">{l.abertas}</b> : "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtDias(l.tempoMedioContratar)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{l.mediaDiasAbertas != null ? <span style={{ color: corDias(l.mediaDiasAbertas) }} className="font-semibold">{fmtDias(l.mediaDiasAbertas)}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {linhas.length > 15 && (
        <div className="border-t border-border p-2 text-center">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setTodos((t) => !t)}>{todos ? "Mostrar só os 15 primeiros" : `Mostrar todos (${linhas.length})`}</Button>
        </div>
      )}
    </Card>
  );
}

// ---- Tempo por etapa ------------------------------------------------------------------

function AbaEtapas({ p, etapas }: { p: PainelVagas; etapas: LinhaEtapa[] }) {
  const fluxo = etapas.filter((e) => e.chave !== "legado" && e.chave !== "outros");
  const gargalo = [...fluxo].filter((e) => e.media != null).sort((a, b) => (b.media ?? 0) - (a.media ?? 0))[0];
  const travada = [...etapas].sort((a, b) => b.paradasAgora - a.paradasAgora)[0];
  const dados = fluxo.map((e) => ({ nome: e.titulo, chave: e.chave, media: n1(e.media), mediana: n1(e.mediana) }));
  const paradas = etapas.filter((e) => e.paradasAgora > 0).map((e) => ({ nome: e.titulo, chave: e.chave, n: e.paradasAgora, dias: n1(e.mediaParadas) }));
  const somaMedias = fluxo.reduce((s, e) => s + (e.media ?? 0), 0);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
          <div>
            <p className="text-xs font-medium text-muted-foreground">Etapa mais demorada (gargalo)</p>
            <p className="text-lg font-bold">{gargalo ? gargalo.titulo : "—"}</p>
            {gargalo && <p className="text-[11px] text-muted-foreground">média {fmtDias(gargalo.media)} · mediana {fmtDias(gargalo.mediana)} · {gargalo.vagas} vagas</p>}
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <Hourglass className="mt-0.5 h-5 w-5 text-warning" />
          <div>
            <p className="text-xs font-medium text-muted-foreground">Onde mais vagas estão paradas agora</p>
            <p className="text-lg font-bold">{travada?.paradasAgora ? travada.titulo : "—"}</p>
            {travada?.paradasAgora ? <p className="text-[11px] text-muted-foreground">{travada.paradasAgora} vagas · há {fmtDias(travada.mediaParadas)} em média · a mais parada há {fmtDias(travada.maiorParada)}</p> : null}
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <Timer className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <p className="text-xs font-medium text-muted-foreground">Soma das médias das etapas</p>
            <p className="text-lg font-bold">{fmtDias(somaMedias)}</p>
            <p className="text-[11px] text-muted-foreground">Quanto leva uma vaga "típica" que passa por todas as etapas.</p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">Tempo médio em cada etapa (vagas do período)</p>
          {dados.length ? (
            <ResponsiveContainer width="100%" height={Math.max(220, dados.length * 42)}>
              <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} unit=" d" />
                <YAxis type="category" dataKey="nome" width={150} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number, k: string) => [fmtDias(v), k]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="media" name="Média" radius={[0, 3, 3, 0]}>
                  {dados.map((d) => <Cell key={d.chave} fill={COR_ETAPA[d.chave]} />)}
                  <LabelList dataKey="media" position="right" fontSize={10} formatter={(v: number) => fmtDias(v)} />
                </Bar>
                <Bar dataKey="mediana" name="Mediana" fill="#cbd5e1" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <SemDados texto="Nenhuma vaga do período passou por etapas registradas no log." />}
        </Card>
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">Vagas abertas paradas em cada etapa agora</p>
          {paradas.length ? (
            <ResponsiveContainer width="100%" height={Math.max(220, paradas.length * 42)}>
              <BarChart data={paradas} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="nome" width={150} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number, k: string) => (k === "Vagas" ? v : fmtDias(v))} />
                <Bar dataKey="n" name="Vagas" radius={[0, 3, 3, 0]}>
                  {paradas.map((d) => <Cell key={d.chave} fill={COR_ETAPA[d.chave]} />)}
                  <LabelList dataKey="n" position="right" fontSize={11} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <SemDados texto="Nenhuma vaga aberta." />}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">Detalhe por etapa</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">Etapa</th><th className="px-3 py-2">Quem cuida</th>
              <th className="px-3 py-2 text-right">Vagas que passaram</th><th className="px-3 py-2 text-right">Média</th>
              <th className="px-3 py-2 text-right">Mediana</th><th className="px-3 py-2 text-right">Maior</th>
              <th className="px-3 py-2 text-right">Paradas agora</th><th className="px-3 py-2 text-right">Paradas há (média)</th><th className="px-3 py-2 text-right">Mais parada</th>
            </tr></thead>
            <tbody>
              {etapas.map((e) => (
                <tr key={e.chave} className="border-t border-border/60">
                  <td className="px-3 py-1.5 font-medium"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: COR_ETAPA[e.chave] }} />{e.titulo}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{PASSOS_FLUXO.find((x) => x.chave === e.chave)?.quem ?? (e.chave === "legado" ? "Vagas do Discord: só o tempo total" : "Status fora do fluxo")}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{e.vagas || "—"}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmtDias(e.media)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtDias(e.mediana)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtDias(e.maximo)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{e.paradasAgora ? <b className="text-warning">{e.paradasAgora}</b> : "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtDias(e.mediaParadas)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{e.maiorParada != null ? <span style={{ color: corDias(e.maiorParada) }} className="font-semibold">{fmtDias(e.maiorParada)}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Medido pelo log de troca de status (desde {fmtData(p.log_desde)}). Uma vaga que voltou para uma etapa soma os dois períodos nela. "Paradas agora" conta todas as abertas, mesmo as pedidas antes do período.
        </p>
      </Card>
    </>
  );
}

// ---- Em aberto agora ------------------------------------------------------------------

function AbaAbertas({ p, onAbrir }: { p: PainelVagas; onAbrir: (v: VagaPainel) => void }) {
  const abertas = useMemo(() => p.vagas.filter((v) => !vagaFechada(v))
    .map((v) => ({ v, total: diasTotais(v, p.agora), noStatus: diasNoStatus(v, p.agora), etapa: etapaDoStatus(v.status) }))
    .sort((a, b) => b.total - a.total), [p]);
  if (!abertas.length) return <Card className="p-6"><SemDados texto="Nenhuma vaga em aberto com esses filtros." /></Card>;
  return (
    <Card className="overflow-hidden">
      <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">{abertas.length} vagas em aberto — da mais antiga para a mais nova</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2">Vaga</th><th className="px-3 py-2">Contrato · cidade</th><th className="px-3 py-2">Etapa atual</th>
            <th className="px-3 py-2 text-right">Na etapa há</th><th className="px-3 py-2 text-right">Aberta há</th>
            <th className="px-3 py-2 text-right">Candidatos</th><th className="px-3 py-2">Urgência</th><th className="px-3 py-2">Solicitante</th>
          </tr></thead>
          <tbody>
            {abertas.map(({ v, total, noStatus, etapa }) => (
              <tr key={v.id} className="cursor-pointer border-t border-border/60 hover:bg-muted/40" onClick={() => onAbrir(v)}>
                <td className="px-3 py-1.5"><span className="font-medium text-primary">{tituloVaga(v)}</span>{v.qtd > 1 && <span className="text-muted-foreground"> ×{v.qtd}</span>}</td>
                <td className="max-w-[260px] truncate px-3 py-1.5 text-muted-foreground" title={v.contrato ?? ""}>{v.contrato ?? "—"}{v.cidade ? ` · ${v.cidade}` : ""}</td>
                <td className="px-3 py-1.5"><EtiquetaEtapa chave={etapa} status={v.status} /></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtDias(noStatus, 0)}</td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ color: corDias(total) }}>{fmtDias(total, 0)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{v.cand.total || "—"}</td>
                <td className="max-w-[160px] truncate px-3 py-1.5 text-muted-foreground">{v.urgencia ?? "—"}</td>
                <td className="max-w-[160px] truncate px-3 py-1.5 text-muted-foreground">{v.solicitante ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---- Todas as vagas ---------------------------------------------------------------------

type OrdVagas = "id" | "total" | "cand";

function AbaVagas({ p, onAbrir }: { p: PainelVagas; onAbrir: (v: VagaPainel) => void }) {
  const [ord, setOrd] = useState<OrdVagas>("id");
  const [limite, setLimite] = useState(60);
  const linhas = useMemo(() => p.vagas.filter((v) => v.no_periodo).map((v) => {
    const tr = trechosDaVaga(v, p.agora);
    return { v, tr, total: diasTotais(v, p.agora), porEtapa: diasPorEtapa(tr, true) };
  }).sort((a, b) => (ord === "total" ? b.total - a.total : ord === "cand" ? b.v.cand.total - a.v.cand.total : b.v.id - a.v.id)), [p, ord]);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <p className="mr-auto text-sm font-semibold">{linhas.length} vagas solicitadas no período <span className="font-normal text-muted-foreground">— clique para abrir o dashboard da vaga</span></p>
        <Select value={ord} onValueChange={(v) => setOrd(v as OrdVagas)}>
          <SelectTrigger className="h-7 w-48 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="id">Mais recentes primeiro</SelectItem>
            <SelectItem value="total">Mais demoradas primeiro</SelectItem>
            <SelectItem value="cand">Mais candidatos primeiro</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-3 border-b border-border px-4 py-2 text-[10px] text-muted-foreground">
        {ETAPAS.filter((e) => e.chave !== "contratado").map((e) => (
          <span key={e.chave} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: COR_ETAPA[e.chave] }} />{e.titulo}</span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2">Vaga</th><th className="px-3 py-2">Pedida em</th><th className="px-3 py-2">Desfecho</th>
            <th className="w-[32%] px-3 py-2">Tempo em cada etapa</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Cand.</th>
          </tr></thead>
          <tbody>
            {linhas.slice(0, limite).map(({ v, total, porEtapa }) => (
              <tr key={v.id} className="cursor-pointer border-t border-border/60 hover:bg-muted/40" onClick={() => onAbrir(v)}>
                <td className="max-w-[300px] px-3 py-1.5">
                  <p className="truncate font-medium text-primary">{tituloVaga(v)}{v.qtd > 1 && <span className="text-muted-foreground"> ×{v.qtd}</span>}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{v.contrato ?? "—"}{v.cidade ? ` · ${v.cidade}` : ""}</p>
                </td>
                <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{fmtData(v.criada)}</td>
                <td className="px-3 py-1.5"><SeloDesfecho v={v} /></td>
                <td className="px-3 py-1.5"><BarraEtapas porEtapa={porEtapa} /></td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmtDias(total, 0)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{v.cand.total || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {linhas.length > limite && (
        <div className="border-t border-border p-2 text-center">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setLimite((l) => l + 100)}>Mostrar mais ({linhas.length - limite} restantes)</Button>
        </div>
      )}
    </Card>
  );
}

/** Barra empilhada: proporção do tempo da vaga em cada etapa. */
function BarraEtapas({ porEtapa }: { porEtapa: Record<string, number> }) {
  const total = Object.values(porEtapa).reduce((a, b) => a + b, 0);
  if (!total) return <span className="text-[10px] text-muted-foreground">—</span>;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded bg-muted">
      {ETAPAS.filter((e) => porEtapa[e.chave]).map((e) => (
        <div key={e.chave} title={`${e.titulo}: ${fmtDias(porEtapa[e.chave])}`} style={{ width: `${(porEtapa[e.chave] / total) * 100}%`, background: COR_ETAPA[e.chave] }} />
      ))}
    </div>
  );
}

function SeloDesfecho({ v }: { v: VagaPainel }) {
  const d = desfechoVaga(v);
  const Icone = d === "contratada" ? CheckCircle2 : d === "andamento" ? Clock : XCircle;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium" style={{ color: COR_DESFECHO[d] }}>
      <Icone className="h-3.5 w-3.5" /> {d === "andamento" ? tituloEtapa(etapaDoStatus(v.status)) : ROTULO_DESFECHO[d]}
    </span>
  );
}

function EtiquetaEtapa({ chave, status }: { chave: string; status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={status}>
      <span className="h-2 w-2 rounded-full" style={{ background: COR_ETAPA[chave] }} /> {tituloEtapa(chave)}
    </span>
  );
}

function SemDados({ texto = "Sem dados no período." }: { texto?: string }) {
  return <p className="py-8 text-center text-xs text-muted-foreground">{texto}</p>;
}

// ---- Dashboard de UMA vaga -----------------------------------------------------------

function DashboardVaga({ vaga, painel, etapas, onClose }: { vaga: VagaPainel | null; painel: PainelVagas; etapas: LinhaEtapa[]; onClose: () => void }) {
  const q = useVagaDetalhe(vaga?.id ?? null);
  const d = q.data;
  const agora = painel.agora;
  const trechos = useMemo(() => (vaga ? trechosDaVaga(vaga, agora) : []), [vaga, agora]);
  const porEtapa = useMemo(() => diasPorEtapa(trechos, true), [trechos]);
  if (!vaga) return null;

  const desf = desfechoVaga(vaga);
  const estados = estadosDosPassos(vaga.status, d ? statusAntesDoFim(d.historico) : null);
  const total = diasTotais(vaga, agora);
  const aprov = tempoAprovacao(vaga);
  const primeiroCand = vaga.cand.primeiro_em ? diasEntreMs(+new Date(vaga.criada), +new Date(vaga.cand.primeiro_em)) : null;
  const mediaDe = (k: string) => etapas.find((e) => e.chave === k)?.media ?? null;
  const comparacao = ETAPAS.filter((e) => porEtapa[e.chave] != null || (mediaDe(e.chave) != null && e.chave !== "legado" && e.chave !== "outros"))
    .filter((e) => e.chave !== "contratado")
    .map((e) => ({ nome: e.titulo, chave: e.chave, vaga: n1(porEtapa[e.chave] ?? 0), media: n1(mediaDe(e.chave)) }));
  const maxTrecho = Math.max(1, ...trechos.map((t) => t.dias));
  const etapasCand = Object.entries(vaga.cand.etapas).sort((a, b) => b[1] - a[1]);
  const ficha: [string, string | null | undefined][] = [
    ["Contrato", vaga.contrato], ["Cidade", vaga.cidade ? `${vaga.cidade}${vaga.uf ? `/${vaga.uf}` : ""}` : null], ["Setor", vaga.setor],
    ["Motivo", vaga.motivo], ["Substituindo", vaga.substituido], ["Urgência", vaga.urgencia], ["Quantidade", String(vaga.qtd)],
    ["Solicitante", vaga.solicitante], ["Analista", vaga.analista], ["Aprovada por", vaga.aprovado_por],
    ["Escala", d?.vaga?.escala], ["Horário", d?.vaga?.horario], ["Salário", d?.vaga?.salario], ["Início previsto", vaga.inicio_previsto],
    ["Contratado", vaga.contratado], ["Início do contratado", d?.vaga?.contratado_inicio], ["Motivo da reprovação", vaga.motivo_reprovacao],
  ];

  return (
    <Dialog open={!!vaga} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Briefcase className="h-5 w-5 text-primary" /> {tituloVaga(vaga)}
            <Badge variant="outline" style={{ borderColor: COR_DESFECHO[desf], color: COR_DESFECHO[desf] }}>{vaga.status}</Badge>
            {vaga.legado && <Badge variant="secondary">Sistema antigo</Badge>}
            {vaga.encarregado && <Badge variant="secondary">Encarregado</Badge>}
            {vaga.reserva && <Badge variant="secondary">Reserva técnica</Badge>}
          </DialogTitle>
          <DialogDescription>
            {vaga.contrato ?? "Sem contrato"}{vaga.cidade ? ` · ${vaga.cidade}` : ""} · pedida em {fmtDataHora(vaga.criada)}{vaga.solicitante ? ` por ${vaga.solicitante}` : ""}
          </DialogDescription>
        </DialogHeader>

        {/* Régua do fluxo */}
        <div className="grid grid-cols-4 gap-1 sm:grid-cols-8">
          {PASSOS_FLUXO.map((ps, i) => {
            const e = estados[i];
            const cls = e === "feito" ? "border-success/40 bg-success/10 text-success" : e === "atual" ? "border-primary bg-primary/10 text-primary font-semibold"
              : e === "parado" ? "border-destructive/50 bg-destructive/10 text-destructive font-semibold" : "border-border text-muted-foreground";
            return (
              <div key={ps.chave} className={`rounded-md border px-1.5 py-1.5 text-center text-[10px] leading-tight ${cls}`}>
                <div className="text-sm">{ps.icone}</div>{ps.titulo}
                {porEtapa[ps.chave] != null && <div className="mt-0.5 font-mono text-[10px]">{fmtDias(porEtapa[ps.chave])}</div>}
              </div>
            );
          })}
        </div>

        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <MiniKpi icone={Timer} rotulo={vagaFechada(vaga) ? "Tempo total (até fechar)" : "Aberta há"} valor={fmtDias(total)} cor={corDias(total)} />
          <MiniKpi icone={Hourglass} rotulo="No status atual" valor={vagaFechada(vaga) ? "—" : fmtDias(diasNoStatus(vaga, agora))} />
          <MiniKpi icone={CheckCircle2} rotulo="Até aprovar" valor={fmtDias(aprov)} />
          <MiniKpi icone={Users} rotulo="1º candidato após" valor={fmtDias(primeiroCand)} />
          <MiniKpi icone={Users} rotulo="Candidatos" valor={String(vaga.cand.total)} />
          <MiniKpi icone={XCircle} rotulo="Desistências" valor={String(vaga.cand.desistiu)} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <p className="mb-2 text-sm font-semibold">Esta vaga × média das vagas do período</p>
            {comparacao.length ? (
              <ResponsiveContainer width="100%" height={Math.max(200, comparacao.length * 38)}>
                <BarChart data={comparacao} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} unit=" d" />
                  <YAxis type="category" dataKey="nome" width={140} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number, k: string) => [fmtDias(v), k]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="vaga" name="Esta vaga" radius={[0, 3, 3, 0]}>
                    {comparacao.map((c) => <Cell key={c.chave} fill={COR_ETAPA[c.chave]} />)}
                  </Bar>
                  <Bar dataKey="media" name="Média" fill="#cbd5e1" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <SemDados texto="Sem trechos medidos para esta vaga." />}
          </Card>
          <Card className="p-4">
            <p className="mb-2 text-sm font-semibold">Quanto tempo ficou em cada status</p>
            {trechos.length ? (
              <div className="space-y-1.5">
                {trechos.map((t, i) => (
                  <div key={i} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium" title={t.status}>{t.status}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{fmtDias(t.dias)}{t.aberto && " · agora"}</span>
                    </div>
                    <div className="mt-0.5 h-2 overflow-hidden rounded bg-muted">
                      <div className={`h-full rounded ${t.aberto ? "animate-pulse" : ""}`} style={{ width: `${Math.max(2, (t.dias / maxTrecho) * 100)}%`, background: COR_ETAPA[t.etapa] }} />
                    </div>
                    <p className="text-[10px] text-muted-foreground">{fmtDataHora(t.inicio)} → {t.fim ? fmtDataHora(t.fim) : "hoje"}</p>
                  </div>
                ))}
              </div>
            ) : <SemDados texto="Sem trechos medidos." />}
            {vaga.legado && !vaga.log.length && <p className="mt-2 text-[11px] text-muted-foreground">Vaga do sistema antigo: só o tempo total (pedido → fechamento) é conhecido.</p>}
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-4">
            <p className="mb-2 text-sm font-semibold">Ficha da vaga</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {ficha.filter(([, v]) => v).map(([k, v]) => (
                <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="break-words font-medium">{v}</dd></Fragment>
              ))}
            </dl>
          </Card>
          <Card className="overflow-hidden lg:col-span-2">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
              <p className="mr-auto text-sm font-semibold">Candidatos ({vaga.cand.total})</p>
              {etapasCand.map(([e, n]) => <Badge key={e} variant="outline" className="text-[10px]">{e}: {n}</Badge>)}
            </div>
            {q.isLoading ? <p className="flex items-center gap-2 p-4 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…</p>
              : d?.candidatos.length ? (
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card"><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-1.5">Nome</th><th className="px-3 py-1.5">Etapa</th><th className="px-3 py-1.5">Entrou</th>
                      <th className="px-3 py-1.5 text-right">Na etapa há</th><th className="px-3 py-1.5">Obs.</th>
                    </tr></thead>
                    <tbody>
                      {d.candidatos.map((c) => (
                        <tr key={c.id} className="border-t border-border/60">
                          <td className="px-3 py-1.5 font-medium">{c.nome ?? "—"}</td>
                          <td className="px-3 py-1.5">{c.desistiu ? <span className="text-destructive">DESISTIU</span> : c.etapa}</td>
                          <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{fmtData(c.criado)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{c.etapa_em ? fmtDias(diasEntreMs(+new Date(c.etapa_em), +new Date(agora)), 0) : "—"}</td>
                          <td className="max-w-[220px] truncate px-3 py-1.5 text-muted-foreground" title={c.desistencia_motivo ?? c.motivo_reprovacao ?? ""}>
                            {c.desistencia_motivo ?? c.motivo_reprovacao ?? (c.enviado_em ? `Enviado à admissão ${fmtData(c.enviado_em)}` : c.origem ?? "")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <SemDados texto="Nenhum candidato ligado a esta vaga." />}
          </Card>
        </div>

        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold">Linha do tempo completa</p>
          {q.isLoading ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…</p>
            : q.error ? <p className="text-xs text-destructive">{(q.error as Error).message}</p>
            : d?.historico.length ? (
              <ol className="relative space-y-2 border-l border-border pl-4">
                {d.historico.map((h, i) => {
                  const ant = i > 0 ? d.historico[i - 1].created_at : vaga.criada;
                  const intervalo = diasEntreMs(+new Date(ant), +new Date(h.created_at));
                  return (
                    <li key={h.id} className="text-xs">
                      <span className="absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full border-2 border-background" style={{ background: h.candidato_nome ? "#94a3b8" : COR_ETAPA[etapaDoStatus(h.para_status)] ?? "#64748b" }} />
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">{h.evento ?? "Movimentação"}</span>
                        {h.de_status && h.para_status && h.de_status !== h.para_status && <span className="text-muted-foreground">{h.de_status} → {h.para_status}</span>}
                        {h.candidato_nome && <Badge variant="outline" className="text-[10px]">{h.candidato_nome}</Badge>}
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {fmtDataHora(h.created_at)}{h.papel ? ` · ${h.papel}` : ""}{h.usuario_nome ? ` · ${h.usuario_nome}` : ""}{i > 0 && intervalo >= 0.01 ? ` · +${fmtDias(intervalo)}` : ""}
                      </p>
                      {h.detalhe && <p className="text-[11px] italic text-muted-foreground">{h.detalhe}</p>}
                    </li>
                  );
                })}
              </ol>
            ) : <SemDados texto="Sem histórico registrado." />}
        </Card>
      </DialogContent>
    </Dialog>
  );
}

function MiniKpi({ icone: Icone, rotulo, valor, cor }: { icone: typeof Timer; rotulo: string; valor: string; cor?: string }) {
  return (
    <Card className="p-3">
      <p className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground"><Icone className="h-3 w-3" /> {rotulo}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums" style={cor ? { color: cor } : undefined}>{valor}</p>
    </Card>
  );
}
