import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertOctagon, AlertTriangle, ArrowRight, Briefcase, CalendarClock, CheckCircle2, ClipboardCheck, Clock,
  FileSpreadsheet, Gauge, HelpCircle, Hourglass, Loader2, Maximize2, Minimize2, RefreshCw, Search, Target, Timer,
  TrendingUp, UserCheck, UserMinus, UserPlus, Users, UserX, XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FiltroContratos } from "@/components/solicitacoes/FiltroContratos";
import { StatusSolicitacao, type SolicitacaoStatus } from "@/components/recrutamento/StatusSolicitacao";
import { usePermissoes } from "@/context/PermissoesContext";
import { useDashboardRecrutamento } from "@/hooks/useDashboardRecrutamento";
import { rotuloStatusVaga } from "@/lib/recrutamento/vagaRegras";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  COR_PRAZO, FILTROS_VAZIOS, JANELA_ATENCAO, ROTULO_PERIODO, ROTULO_PRAZO, SITUACOES_PRAZO, URGENCIAS,
  dataBr, filtrar, funilAberto, hojeSP, idadeDasAbertas, indicadoresAgora, indicadoresCandidatos, indicadoresPeriodo,
  intervalo, mesesDoIntervalo, noIntervalo, porMes, prazoPorContrato, ranking, rotuloCargo, rotuloCidade, rotuloContrato, rotuloMotivo,
  tempoAteContratar, urgencia, vagasAbertas,
  type Andamento, type FiltrosDash, type LinhaAberta, type Periodo, type SituacaoPrazo, type Urgencia,
} from "@/lib/recrutamento/dashboardRecrutamento";

// =====================================================================
// Recrutamento e Seleção › DASHBOARD RECRUTAMENTO (02/10/2026, mig 288)
//
// Pedido do Pablo: "dashboard COMPLETO sobre o sistema de RECRUTAMENTO E
// SELEÇÃO, submódulo novo, com MUITA qualidade e profissionalismo" — com o
// painel em Power BI do RH como referência (vagas em atenção, no prazo,
// atrasadas "com ação imediata", e a tabela de vagas atrasadas e próximas
// com os dias que faltam e o candidato).
//
// Três blocos, nesta ordem:
//   1. SITUAÇÃO AGORA — vagas em aberto hoje, o prazo de cada uma e onde
//      estão no fluxo. Não depende do período.
//   2. DESEMPENHO NO PERÍODO — solicitadas, contratadas, reprovadas e o
//      tempo de cada passo (aprovar, abrir, contratar).
//   3. CANDIDATOS — o funil do kanban e as candidaturas do período.
// Os cálculos moram em src/lib/recrutamento/dashboardRecrutamento.ts (com
// teste); aqui só se desenha. Clicar numa vaga abre o mesmo "Status" da
// Gestão Recrutamento. "Tela cheia" é para a TV do RH: os dados se
// atualizam sozinhos a cada 5 minutos.
//
// Cores (skill dataviz): status (atrasada/atenção/no prazo) só onde a cor
// SIGNIFICA estado, e sempre com rótulo ou ícone ao lado; gráficos de uma
// série usam uma cor só; duas séries = slots 1 e 2 da paleta validada.
// =====================================================================

const MENU = "recrutamento_dashboard";
const COR_SERIE = "#2a78d6";
const COR_SERIE_2 = "#eb6834";
const MARINHO = "#0f3171";
const EIXO = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const GRADE = "hsl(var(--border))";
const TOOLTIP = {
  contentStyle: {
    background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 10,
    fontSize: 12, color: "hsl(var(--popover-foreground))", boxShadow: "0 8px 24px rgba(15,23,42,.12)",
  },
  labelStyle: { fontWeight: 700, color: "hsl(var(--foreground))", marginBottom: 2 },
  cursor: { fill: "hsl(var(--muted))", opacity: 0.55 },
};

const num = (n: number) => n.toLocaleString("pt-BR");
const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`);
const diasTxt = (n: number | null) => {
  if (n == null) return "—";
  if (n < 1 / 24) return `${Math.max(1, Math.round(n * 1440))} min`;
  if (n < 1) return `${Math.round(n * 24)} h`;
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: n < 10 ? 1 : 0 })} ${n < 2 ? "dia" : "dias"}`;
};
/** Rótulo curto na ponta da barra (sem espaço, para não quebrar linha). */
const diasCurto = (n: number) =>
  n < 1 / 24 ? `${Math.max(1, Math.round(n * 1440))}min` : n < 1 ? `${Math.round(n * 24)}h` : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}d`;
const TODAS = "__todas";

// ── Peças ────────────────────────────────────────────────────────────────

function Secao({ titulo, sub, icone, acao, children }: { titulo: string; sub?: string; icone: ReactNode; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: MARINHO }}>{icone}</span>
          <div>
            <h2 className="text-base font-extrabold tracking-tight text-foreground">{titulo}</h2>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Tile({ icone, rotulo, valor, sub, cor = MARINHO, onClick, ativo }: {
  icone: ReactNode; rotulo: string; valor: string; sub?: ReactNode; cor?: string; onClick?: () => void; ativo?: boolean;
}) {
  const miolo = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${cor}17`, color: cor }}>{icone}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{rotulo}</p>
        <p className="text-2xl font-extrabold leading-tight text-foreground">{valor}</p>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </div>
    </>
  );
  return (
    <Card className={cn("overflow-hidden transition", onClick && "hover:-translate-y-0.5 hover:shadow-md", ativo && "ring-2 ring-offset-1")}
          style={ativo ? { ["--tw-ring-color" as string]: cor } : undefined}>
      {onClick
        ? <button type="button" onClick={onClick} className="flex w-full items-start gap-3 p-4 text-left">{miolo}</button>
        : <div className="flex w-full items-start gap-3 p-4">{miolo}</div>}
    </Card>
  );
}

const ICONE_PRAZO: Record<SituacaoPrazo, ReactNode> = {
  atrasada: <AlertOctagon className="h-5 w-5" />,
  atencao: <AlertTriangle className="h-5 w-5" />,
  no_prazo: <CheckCircle2 className="h-5 w-5" />,
  sem_data: <HelpCircle className="h-5 w-5" />,
};
const DICA_PRAZO: Record<SituacaoPrazo, string> = {
  atrasada: "data de início prevista já passou",
  atencao: `vence em até ${JANELA_ATENCAO} dias`,
  no_prazo: `vence em mais de ${JANELA_ATENCAO} dias`,
  sem_data: "data de início não informada ou ilegível",
};

function TilePrazo({ s, qtd, total, ativo, onClick }: { s: SituacaoPrazo; qtd: number; total: number; ativo: boolean; onClick: () => void }) {
  const cor = COR_PRAZO[s];
  const parte = total ? qtd / total : 0;
  return (
    <button type="button" onClick={onClick} title={`Mostrar na tabela: ${ROTULO_PRAZO[s]}`}
      className={cn("group relative overflow-hidden rounded-xl border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
        ativo ? "border-transparent ring-2" : "border-border")}
      style={ativo ? { ["--tw-ring-color" as string]: cor } : undefined}>
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: cor }} />
      <div className="flex items-start justify-between gap-2 pl-1.5">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{ROTULO_PRAZO[s]}</p>
          <p className="text-3xl font-extrabold leading-none text-foreground">{num(qtd)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{DICA_PRAZO[s]}</p>
        </div>
        <span style={{ color: cor }}>{ICONE_PRAZO[s]}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted pl-1.5">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(parte * 100)}%`, background: cor }} />
      </div>
      <p className="mt-1 pl-1.5 text-[11px] font-semibold text-muted-foreground">{pct(parte)} das vagas em aberto</p>
    </button>
  );
}

function Grafico({ titulo, sub, children, className = "", vazio }: { titulo: string; sub?: string; children: ReactNode; className?: string; vazio?: boolean }) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="mb-3">
        <h3 className="text-sm font-bold text-foreground">{titulo}</h3>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      {vazio ? <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">Sem dados neste recorte.</p> : children}
    </Card>
  );
}

/** Barras horizontais de uma série (ranking), valor na ponta. "Outros" vira nota. */
function Ranking({ dados: todos, rotulo, largura = 170 }: { dados: { nome: string; qtd: number }[]; rotulo: string; largura?: number }) {
  const outros = todos.find((d) => d.nome.startsWith("Outros ("));
  const dados = todos.filter((d) => d !== outros);
  const corte = Math.floor(largura / 6.6);
  return (
    <>
      <ResponsiveContainer width="100%" height={Math.max(120, dados.length * 28 + 16)}>
        <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 0 }} barCategoryGap={5}>
          <CartesianGrid horizontal={false} stroke={GRADE} />
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="nome" width={largura} tickLine={false} axisLine={false}
            tick={({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => (
              <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="hsl(var(--foreground))">
                <title>{payload.value}</title>
                {payload.value.length > corte ? `${payload.value.slice(0, corte - 1)}…` : payload.value}
              </text>
            )} />
          <Tooltip {...TOOLTIP} formatter={(v: number) => [num(v), rotulo]} />
          <Bar dataKey="qtd" fill={COR_SERIE} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
            <LabelList dataKey="qtd" position="right" style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {outros && <p className="mt-1 text-xs text-muted-foreground">+ {outros.nome.match(/\d+/)?.[0]} outros fora do ranking, somando {num(outros.qtd)}</p>}
    </>
  );
}

/** Colunas de uma série (faixas ordenadas). */
function Colunas({ dados, rotulo, altura = 210 }: { dados: { nome: string; qtd: number }[]; rotulo: string; altura?: number }) {
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <BarChart data={dados} margin={{ top: 18, right: 8, bottom: 0, left: -18 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke={GRADE} />
        <XAxis dataKey="nome" tick={EIXO} tickLine={false} axisLine={{ stroke: GRADE }} interval={0} />
        <YAxis tick={EIXO} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip {...TOOLTIP} formatter={(v: number) => [num(v), rotulo]} />
        <Bar dataKey="qtd" fill={COR_SERIE} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
          <LabelList dataKey="qtd" position="top" style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const COR_URGENCIA: Record<Urgencia, string> = {
  Alta: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  "Média": "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  Baixa: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  "Não informada": "bg-muted text-muted-foreground border-border",
};
const COR_ANDAMENTO: Record<Andamento, string> = {
  "Aguardando aprovação": "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
  "Conferência do Recrutamento": "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  "Em seleção": "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
};

function PilulaPrazo({ v }: { v: LinhaAberta }) {
  const f = v.faltam;
  const cls: Record<SituacaoPrazo, string> = {
    atrasada: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
    atencao: "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
    no_prazo: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
    sem_data: "bg-muted text-muted-foreground border-border",
  };
  const texto = f == null ? "sem data" : f < 0 ? `${num(-f)}d atrasada` : f === 0 ? "vence hoje" : `faltam ${num(f)}d`;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-bold tabular-nums", cls[v.situacao])}>
      {v.situacao === "atrasada" && <AlertOctagon className="h-3 w-3" />}
      {v.situacao === "atencao" && <AlertTriangle className="h-3 w-3" />}
      {texto}
    </span>
  );
}

// ── A tela ───────────────────────────────────────────────────────────────

export default function DashboardRecrutamento() {
  const q = useDashboardRecrutamento();
  const { can } = usePermissoes();
  const podeExportar = can("exportar", undefined, MENU);
  const hoje = hojeSP();

  const [periodo, setPeriodo] = useState<Periodo>("ano");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [filtros, setFiltros] = useState<FiltrosDash>(FILTROS_VAZIOS);
  const [fPrazo, setFPrazo] = useState<"" | SituacaoPrazo>("");
  const [fAndamento, setFAndamento] = useState<"" | Andamento>("");
  const [busca, setBusca] = useState("");
  const [statusDe, setStatusDe] = useState<SolicitacaoStatus | null>(null);
  const [telaCheia, setTelaCheia] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const tabelaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sinc = () => setTelaCheia(document.fullscreenElement === raiz.current);
    document.addEventListener("fullscreenchange", sinc);
    return () => document.removeEventListener("fullscreenchange", sinc);
  }, []);
  const alternarTelaCheia = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await raiz.current?.requestFullscreen();
    } catch { toast.error("O navegador não deixou abrir em tela cheia."); }
  };

  const todas = q.data?.vagas ?? [];
  const candidatos = q.data?.candidatos ?? [];

  // Opções dos filtros: do histórico inteiro, mais usadas primeiro.
  const opcoes = useMemo(() => {
    const contar = (f: (v: (typeof todas)[number]) => string) =>
      ranking(todas, f, 500).map((x) => x.nome);
    return { cidades: contar(rotuloCidade), cargos: contar(rotuloCargo), motivos: contar(rotuloMotivo) };
  }, [todas]);

  const vagas = useMemo(() => filtrar(todas, filtros), [todas, filtros]);
  const vagaIds = useMemo(() => new Set(vagas.map((v) => v.id)), [vagas]);
  const candsDoRecorte = useMemo(
    () => (vagas.length === todas.length ? candidatos : candidatos.filter((c) => c.vaga_id != null && vagaIds.has(c.vaga_id))),
    [candidatos, vagas.length, todas.length, vagaIds]);

  // 1. Situação agora
  const abertas = useMemo(() => vagasAbertas(vagas, candidatos, hoje), [vagas, candidatos, hoje]);
  const agora = useMemo(() => indicadoresAgora(abertas), [abertas]);
  const funil = useMemo(() => funilAberto(abertas), [abertas]);
  const porContrato = useMemo(() => prazoPorContrato(abertas, 10), [abertas]);
  const idade = useMemo(() => idadeDasAbertas(abertas), [abertas]);
  const abertasPorCargo = useMemo(() => ranking(abertas, rotuloCargo, 8), [abertas]);
  const abertasPorCidade = useMemo(() => ranking(abertas, rotuloCidade, 8), [abertas]);
  const abertasPorUrgencia = useMemo(
    () => URGENCIAS.map((u) => ({ nome: u, qtd: abertas.filter((v) => urgencia(v.urgencia) === u).length })).filter((x) => x.qtd > 0 || x.nome !== "Não informada"),
    [abertas]);

  // 2. Período
  const faixa = useMemo(() => intervalo(periodo, hoje, de, ate), [periodo, hoje, de, ate]);
  const per = useMemo(() => indicadoresPeriodo(vagas, faixa), [vagas, faixa]);
  const meses = useMemo(() => porMes(vagas, mesesDoIntervalo(faixa, hoje)), [vagas, faixa, hoje]);
  const ateContratar = useMemo(() => tempoAteContratar(vagas, faixa), [vagas, faixa]);
  const solicitadasPer = useMemo(() => vagas.filter((v) => noIntervalo(v.criada, faixa)), [vagas, faixa]);
  const porMotivo = useMemo(() => ranking(solicitadasPer, rotuloMotivo, 6), [solicitadasPer]);
  const porContratoPer = useMemo(() => ranking(solicitadasPer, rotuloContrato, 8), [solicitadasPer]);
  // Média, não mediana: a maioria das passagens é instantânea (botão atrás
  // de botão) e a mediana zerava quase todas as barras.
  const tempos = useMemo(() => (q.data?.tempos ?? [])
    .filter((t) => t.n >= 2)
    .map((t) => ({ nome: rotuloStatusVaga(t.etapa), qtd: t.media, mediana: t.mediana, n: t.n }))
    .sort((a, b) => b.qtd - a.qtd), [q.data?.tempos]);

  // 3. Candidatos
  const idsAbertas = useMemo(() => new Set(abertas.map((v) => v.id)), [abertas]);
  const cand = useMemo(() => indicadoresCandidatos(candsDoRecorte, faixa, idsAbertas), [candsDoRecorte, faixa, idsAbertas]);
  // Os dois gráficos lado a lado na mesma altura (o card mais baixo sobrava vazio).
  const alturaPar = Math.max(funil.length * 34 + 16, porContrato.length * 30 + 52, 200);

  // Tabela
  const tabela = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return abertas.filter((v) =>
      (!fPrazo || v.situacao === fPrazo)
      && (!fAndamento || v.andamento === fAndamento)
      && (!t || [v.id, v.cargo, v.contrato, v.cidade, v.local, v.solicitante, v.candidato?.nome, v.substituido]
        .some((x) => String(x ?? "").toLowerCase().includes(t))));
  }, [abertas, fPrazo, fAndamento, busca]);

  const rotuloRecorte = useMemo(() => {
    const [i, f] = faixa;
    if (periodo === "tudo") return "todo o histórico";
    return `${i ? dataBr(i) : "início"} a ${f ? dataBr(f) : "hoje"}`;
  }, [faixa, periodo]);

  const filtrosAtivos = filtros.contratos.length + (filtros.cidade ? 1 : 0) + (filtros.cargo ? 1 : 0) + (filtros.urgencia ? 1 : 0) + (filtros.motivo ? 1 : 0);
  const mudarFiltro = (p: Partial<FiltrosDash>) => setFiltros((f) => ({ ...f, ...p }));
  const verNaTabela = (s: "" | SituacaoPrazo) => {
    setFPrazo((atual) => (atual === s ? "" : s));
    window.setTimeout(() => tabelaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const abrirStatus = (v: LinhaAberta) => setStatusDe({
    id: v.id, status: v.status, cargo: v.cargo, contrato: v.contrato, cidade: v.cidade, created_at: v.criada,
    status_changed_at: v.mudou, grau_urgencia: v.urgencia, solicitante_nome: v.solicitante, quantidade_vagas: v.qtd,
  });

  const exportar = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const linhasAbertas = tabela.map((v) => ({
      "Nº": v.id, Cargo: v.cargo ?? "", Local: v.local ?? "", Escala: v.escala ?? "", "Horário": v.horario ?? "",
      Contrato: v.contrato ?? "", Cidade: v.cidade ?? "", "Qtd. vagas": v.qtd, Motivo: v.motivo ?? "", "Urgência": urgencia(v.urgencia),
      "Data projetada": v.prazo.data ? dataBr(v.prazo.data) : "", Imediato: v.prazo.imediato ? "Sim" : "",
      "Dias que faltam": v.faltam ?? "", Prazo: ROTULO_PRAZO[v.situacao], Andamento: v.andamento, Status: rotuloStatusVaga(v.status),
      Candidato: v.candidato?.nome ?? "", "Etapa do candidato": v.candidato?.etapa ?? "", "Candidatos ativos": v.candidato?.total ?? 0,
      "Aberta há (dias)": v.abertaHa, "Solicitada em": dataBr(v.criada), Solicitante: v.solicitante ?? "", "Substituído": v.substituido ?? "",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasAbertas), "Vagas em aberto");
    const resumo = [
      ["DASHBOARD RECRUTAMENTO", `gerado em ${new Date().toLocaleString("pt-BR")}`],
      [],
      ["SITUAÇÃO AGORA", ""],
      ["Vagas em aberto (solicitações)", agora.solicitacoes], ["Posições em aberto", agora.posicoes],
      ["Aguardando aprovação", agora.aprovacao], ["Conferência do Recrutamento", agora.conferencia], ["Em seleção", agora.selecao],
      ...SITUACOES_PRAZO.map((s) => [ROTULO_PRAZO[s], agora.porPrazo[s]]),
      [],
      [`DESEMPENHO — ${rotuloRecorte}`, ""],
      ["Solicitadas", per.solicitadas], ["Contratadas", per.contratadas], ["Reprovadas", per.reprovadas], ["Canceladas", per.canceladas],
      ["Taxa de reprovação", pct(per.taxaReprovacao)], ["Tempo até contratar (mediana)", diasTxt(per.diasContratar.mediana)],
      ["Tempo até aprovar (mediana)", diasTxt(per.diasAprovar.mediana)], ["Tempo até abrir (mediana)", diasTxt(per.diasAbrir.mediana)],
      ["Contratadas dentro do prazo", pct(per.noPrazo.taxa)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), "Resumo");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meses.map((m) => ({ "Mês": m.rotulo, Solicitadas: m.solicitadas, Contratadas: m.contratadas }))), "Por mês");
    XLSX.writeFile(wb, `dashboard-recrutamento-${hoje}.xlsx`);
  };

  const atualizadoAs = q.dataUpdatedAt ? new Date(q.dataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div ref={raiz} className={cn(telaCheia && "h-screen overflow-y-auto bg-background p-6")}>
      <PageHeader
        title="Dashboard Recrutamento"
        subtitle="Vagas em aberto e o prazo de cada uma, o andamento do processo, o tempo de cada etapa e os candidatos — tudo num painel só."
        module="Recrutamento e Seleção"
        breadcrumb={["Dashboard Recrutamento"]}
        actions={
          <>
            {atualizadoAs && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Atualiza sozinho a cada 5 minutos">
                <span className={cn("h-2 w-2 rounded-full", q.isFetching ? "animate-pulse bg-amber-500" : "bg-emerald-500")} />
                Atualizado às {atualizadoAs}
              </span>
            )}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} /> Atualizar
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={alternarTelaCheia}>
              {telaCheia ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />} {telaCheia ? "Sair da tela cheia" : "Tela cheia"}
            </Button>
            {podeExportar && (
              <Button size="sm" className="gap-1.5" onClick={exportar} disabled={!q.data}>
                <FileSpreadsheet className="h-4 w-4" /> Exportar Excel
              </Button>
            )}
          </>
        }
      />

      {/* Filtros: valem para o painel inteiro; o período só para "Desempenho" e "Candidatos". */}
      <Card className="mb-6 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(ROTULO_PERIODO) as Periodo[]).map((p) => <SelectItem key={p} value={p}>{ROTULO_PERIODO[p]}</SelectItem>)}
              </SelectContent>
            </Select>
            {periodo === "personalizado" && (
              <>
                <Input type="date" className="h-9 w-36" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} aria-label="De" />
                <span className="text-xs text-muted-foreground">até</span>
                <Input type="date" className="h-9 w-36" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} aria-label="Até" />
              </>
            )}
          </div>
          <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
          <FiltroContratos linhas={todas} campo="contrato" selecionados={filtros.contratos} onChange={(c) => mudarFiltro({ contratos: c })} />
          <FiltroSelect valor={filtros.cidade} opcoes={opcoes.cidades} todas="Todas as cidades" largura="w-44" onValor={(cidade) => mudarFiltro({ cidade })} />
          <FiltroSelect valor={filtros.cargo} opcoes={opcoes.cargos} todas="Todos os cargos" largura="w-52" onValor={(cargo) => mudarFiltro({ cargo })} />
          <FiltroSelect valor={filtros.urgencia} opcoes={URGENCIAS} todas="Toda urgência" largura="w-36" onValor={(u) => mudarFiltro({ urgencia: u as FiltrosDash["urgencia"] })} />
          <FiltroSelect valor={filtros.motivo} opcoes={opcoes.motivos} todas="Todos os motivos" largura="w-44" onValor={(motivo) => mudarFiltro({ motivo })} />
          {filtrosAtivos > 0 && (
            <Button variant="ghost" size="sm" className="h-9 gap-1 text-xs" onClick={() => setFiltros(FILTROS_VAZIOS)}>
              <XCircle className="h-3.5 w-3.5" /> Limpar filtros ({filtrosAtivos})
            </Button>
          )}
        </div>
      </Card>

      {q.isLoading ? (
        <Carregando />
      ) : q.isError ? (
        <Card className="flex items-start gap-3 border-destructive/40 bg-destructive/5 p-5 text-sm">
          <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold text-destructive">Não foi possível carregar o dashboard.</p>
            <p className="mt-1 text-muted-foreground">{(q.error as Error)?.message}</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-10">
          {/* ── 1. SITUAÇÃO AGORA ─────────────────────────────────────── */}
          <Secao titulo="Situação agora" sub="Vagas em aberto hoje — não depende do período escolhido" icone={<Target className="h-4 w-4" />}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
              <Tile icone={<Briefcase className="h-5 w-5" />} rotulo="Vagas em aberto" valor={num(agora.solicitacoes)}
                    sub={<>{num(agora.posicoes)} {agora.posicoes === 1 ? "posição" : "posições"} a preencher</>}
                    onClick={() => { setFAndamento(""); verNaTabela(""); }} />
              <Tile icone={<Clock className="h-5 w-5" />} rotulo="Aguardando aprovação" valor={num(agora.aprovacao)}
                    sub="Operacional, analista ou Diretoria" ativo={fAndamento === "Aguardando aprovação"}
                    onClick={() => { setFAndamento((a) => (a === "Aguardando aprovação" ? "" : "Aguardando aprovação")); verNaTabela(""); }} />
              <Tile icone={<ClipboardCheck className="h-5 w-5" />} rotulo="Conferência do Recrutamento" valor={num(agora.conferencia)}
                    sub="aprovadas, falta abrir a vaga" ativo={fAndamento === "Conferência do Recrutamento"}
                    onClick={() => { setFAndamento((a) => (a === "Conferência do Recrutamento" ? "" : "Conferência do Recrutamento")); verNaTabela(""); }} />
              <Tile icone={<Users className="h-5 w-5" />} rotulo="Em seleção" valor={num(agora.selecao)}
                    sub={<>{num(agora.candidatosAtivos)} candidatos ativos{agora.semCandidato > 0 && <> · <b className="text-foreground">{num(agora.semCandidato)}</b> sem candidato</>}</>}
                    ativo={fAndamento === "Em seleção"}
                    onClick={() => { setFAndamento((a) => (a === "Em seleção" ? "" : "Em seleção")); verNaTabela(""); }} />
              <Tile icone={<Hourglass className="h-5 w-5" />} rotulo="Idade das vagas em aberto" valor={diasTxt(agora.idadeMediana)}
                    sub="mediana desde a solicitação" />
            </div>

            {agora.porPrazo.atrasada > 0 && (
              <button type="button" onClick={() => verNaTabela("atrasada")}
                className="flex w-full flex-wrap items-center gap-4 rounded-2xl p-4 text-left text-white shadow-lg transition hover:brightness-110"
                style={{ background: "linear-gradient(100deg, #b42323, #d03b3b)" }}>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15"><AlertTriangle className="h-7 w-7" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-widest text-white/80">Atenção — ação imediata necessária</p>
                  <p className="text-xl font-extrabold leading-tight">
                    {num(agora.porPrazo.atrasada)} {agora.porPrazo.atrasada === 1 ? "vaga atrasada" : "vagas atrasadas"}
                    {agora.urgentesAtrasadas > 0 && <span className="font-semibold text-white/90"> · {num(agora.urgentesAtrasadas)} com urgência Alta</span>}
                  </p>
                  <p className="text-sm text-white/85">A data de início prevista já passou e a vaga ainda não foi preenchida.</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-bold text-red-700">
                  Ver as atrasadas <ArrowRight className="h-4 w-4" />
                </span>
              </button>
            )}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {SITUACOES_PRAZO.map((s) => (
                <TilePrazo key={s} s={s} qtd={agora.porPrazo[s]} total={agora.solicitacoes} ativo={fPrazo === s} onClick={() => verNaTabela(s)} />
              ))}
            </div>

            {/* Tabela: o coração do painel — o que atrasou e o que vence logo. */}
            <div ref={tabelaRef} className="scroll-mt-4">
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Vagas em aberto — atrasadas e próximas</h3>
                    <p className="text-xs text-muted-foreground">
                      Ordenadas pelos dias que faltam até a data de início prevista. Clique numa vaga para ver o caminho completo.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
                      {(["", ...SITUACOES_PRAZO] as ("" | SituacaoPrazo)[]).map((s) => (
                        <button key={s || "todas"} type="button" onClick={() => setFPrazo(s)}
                          className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition",
                            fPrazo === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                          {s && <span className="h-2 w-2 rounded-full" style={{ background: COR_PRAZO[s] }} />}
                          {s ? ROTULO_PRAZO[s] : "Todas"}
                          <span className="tabular-nums opacity-70">{s ? agora.porPrazo[s] : agora.solicitacoes}</span>
                        </button>
                      ))}
                    </div>
                    {fAndamento && (
                      <button type="button" onClick={() => setFAndamento("")}
                        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
                        {fAndamento} <XCircle className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input className="h-8 w-60 pl-8 text-sm" placeholder="Nº, cargo, contrato, candidato…" value={busca} onChange={(e) => setBusca(e.target.value)} />
                    </div>
                  </div>
                </div>
                <div className={cn("overflow-auto", telaCheia ? "max-h-[70vh]" : "max-h-[620px]")}>
                  <table className="w-full min-w-[1180px] text-sm">
                    <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                      <tr className="text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2.5">Nº</th>
                        <th className="px-3 py-2.5">Cargo · vaga</th>
                        <th className="px-3 py-2.5">Contrato</th>
                        <th className="px-3 py-2.5">Cidade</th>
                        <th className="px-3 py-2.5">Urgência</th>
                        <th className="px-3 py-2.5">Data projetada</th>
                        <th className="px-3 py-2.5">Dias que faltam</th>
                        <th className="px-3 py-2.5">Andamento</th>
                        <th className="px-3 py-2.5">Candidato</th>
                        <th className="px-3 py-2.5 text-right">Aberta há</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tabela.map((v) => (
                        <tr key={v.id} onClick={() => abrirStatus(v)}
                          className={cn("cursor-pointer border-t border-border transition hover:bg-muted/60",
                            v.situacao === "atrasada" && "bg-red-50/40 dark:bg-red-950/10")}>
                          <td className="px-3 py-2.5 text-xs font-semibold tabular-nums text-muted-foreground">#{v.id}</td>
                          <td className="max-w-[300px] px-3 py-2.5">
                            <p className="font-semibold text-foreground">{v.cargo || "—"}{v.qtd > 1 && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">×{v.qtd}</span>}</p>
                            <p className="line-clamp-1 text-xs text-muted-foreground" title={[v.local, v.escala, v.horario].filter(Boolean).join(" · ")}>
                              {[v.local, v.escala, v.horario].filter(Boolean).join(" · ") || v.motivo || "—"}
                            </p>
                          </td>
                          <td className="max-w-[220px] px-3 py-2.5"><p className="line-clamp-2 text-xs font-medium text-foreground" title={v.contrato ?? ""}>{v.contrato || "—"}</p></td>
                          <td className="px-3 py-2.5 text-xs uppercase text-foreground">{v.cidade || "—"}</td>
                          <td className="px-3 py-2.5">
                            <span className={cn("rounded-md border px-2 py-0.5 text-xs font-bold", COR_URGENCIA[urgencia(v.urgencia)])} title={v.urgencia ?? ""}>{urgencia(v.urgencia)}</span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-foreground">
                            {v.prazo.data ? dataBr(v.prazo.data) : "—"}
                            {v.prazo.imediato && <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">imediato</span>}
                          </td>
                          <td className="px-3 py-2.5"><PilulaPrazo v={v} /></td>
                          <td className="px-3 py-2.5">
                            <span className={cn("whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold", COR_ANDAMENTO[v.andamento])}>{v.andamento}</span>
                            <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground" title={rotuloStatusVaga(v.status)}>{rotuloStatusVaga(v.status)}</p>
                          </td>
                          <td className="max-w-[200px] px-3 py-2.5">
                            {v.candidato ? (
                              <>
                                <p className="line-clamp-1 text-xs font-semibold text-foreground" title={v.candidato.nome}>{v.candidato.nome}</p>
                                <p className="text-[11px] text-muted-foreground">{v.candidato.etapa}{v.candidato.total > 1 && ` · +${v.candidato.total - 1}`}</p>
                              </>
                            ) : v.andamento === "Em seleção" ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400"><UserX className="h-3.5 w-3.5" /> sem candidato</span>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">{num(v.abertaHa)}d</td>
                        </tr>
                      ))}
                      {tabela.length === 0 && (
                        <tr><td colSpan={10} className="px-3 py-12 text-center text-sm text-muted-foreground">Nenhuma vaga em aberto neste recorte.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                  {num(tabela.length)} de {num(abertas.length)} vagas em aberto
                </div>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Grafico titulo="Onde estão as vagas em aberto" sub="Em que passo do fluxo cada solicitação está agora" vazio={!abertas.length}>
                <ResponsiveContainer width="100%" height={alturaPar}>
                  <BarChart data={funil} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap="28%">
                    <CartesianGrid horizontal={false} stroke={GRADE} />
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis type="category" dataKey="nome" width={160} tick={{ ...EIXO, fill: "hsl(var(--foreground))" }} tickLine={false} axisLine={false} />
                    <Tooltip {...TOOLTIP} formatter={(v: number, _n, p) => [num(v), (p?.payload as { quem?: string })?.quem ?? "Vagas"]} />
                    <Bar dataKey="qtd" fill={COR_SERIE} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                      <LabelList dataKey="qtd" position="right" style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Grafico>

              <Grafico titulo="Prazo das vagas em aberto, por contrato" sub="Os 10 contratos com mais vagas em aberto" vazio={!porContrato.length}>
                <ResponsiveContainer width="100%" height={alturaPar}>
                  <BarChart data={porContrato} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 0 }} barCategoryGap="28%">
                    <CartesianGrid horizontal={false} stroke={GRADE} />
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis type="category" dataKey="nome" width={190} tickLine={false} axisLine={false}
                      tick={({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => (
                        <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="hsl(var(--foreground))">
                          <title>{payload.value}</title>{payload.value.length > 28 ? `${payload.value.slice(0, 27)}…` : payload.value}
                        </text>
                      )} />
                    <Tooltip {...TOOLTIP} formatter={(v: number, n: string) => [num(v), ROTULO_PRAZO[n as SituacaoPrazo] ?? n]} />
                    <Legend verticalAlign="top" height={28} iconType="circle" iconSize={8}
                      formatter={(n: string) => <span className="text-xs text-foreground">{ROTULO_PRAZO[n as SituacaoPrazo] ?? n}</span>} />
                    {SITUACOES_PRAZO.map((s, i) => (
                      <Bar key={s} dataKey={s} stackId="p" fill={COR_PRAZO[s]} stroke="hsl(var(--card))" strokeWidth={2} maxBarSize={18}
                        radius={i === SITUACOES_PRAZO.length - 1 ? [0, 4, 4, 0] : 0} isAnimationActive={false}>
                        {/* O total vai na ponta da pilha (o último segmento termina nela). */}
                        {i === SITUACOES_PRAZO.length - 1 && (
                          <LabelList dataKey="total" position="right" style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                        )}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </Grafico>
            </div>

            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              <Grafico titulo="Há quanto tempo estão abertas" sub="Dias desde a solicitação" vazio={!abertas.length}>
                <Colunas dados={idade} rotulo="Vagas" altura={250} />
              </Grafico>
              <Grafico titulo="Urgência" sub="Das vagas em aberto" vazio={!abertas.length}>
                <Colunas dados={abertasPorUrgencia} rotulo="Vagas" altura={250} />
              </Grafico>
              <Grafico titulo="Por cargo" sub="Vagas em aberto" vazio={!abertas.length}>
                <Ranking dados={abertasPorCargo} rotulo="Vagas" largura={130} />
              </Grafico>
              <Grafico titulo="Por cidade" sub="Vagas em aberto" vazio={!abertas.length}>
                <Ranking dados={abertasPorCidade} rotulo="Vagas" largura={130} />
              </Grafico>
            </div>
          </Secao>

          {/* ── 2. DESEMPENHO NO PERÍODO ─────────────────────────────── */}
          <Secao titulo="Desempenho no período" sub={`${ROTULO_PERIODO[periodo]} · ${rotuloRecorte}`} icone={<TrendingUp className="h-4 w-4" />}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
              <Tile icone={<Briefcase className="h-5 w-5" />} rotulo="Solicitadas" valor={num(per.solicitadas)}
                    sub={<>{num(per.posicoesSolicitadas)} posições pedidas</>} />
              <Tile icone={<UserCheck className="h-5 w-5" />} rotulo="Contratadas" valor={num(per.contratadas)}
                    sub={per.canceladas ? <>{num(per.canceladas)} canceladas</> : "vagas preenchidas"} />
              <Tile icone={<XCircle className="h-5 w-5" />} rotulo="Reprovadas" valor={num(per.reprovadas)}
                    sub={<>{pct(per.taxaReprovacao)} das decididas no período</>} />
              <Tile icone={<Timer className="h-5 w-5" />} rotulo="Tempo até contratar" valor={diasTxt(per.diasContratar.mediana)}
                    sub={per.diasContratar.n ? <>mediana · média {diasTxt(per.diasContratar.media)} · {num(per.diasContratar.n)} vagas</> : "sem contratação no período"} />
              <Tile icone={<Gauge className="h-5 w-5" />} rotulo="Contratadas no prazo" valor={pct(per.noPrazo.taxa)}
                    sub={per.noPrazo.n
                      ? <>início até a data prevista · atraso médio {per.noPrazo.atrasoMedio != null && per.noPrazo.atrasoMedio > 0 ? diasTxt(per.noPrazo.atrasoMedio) : "nenhum"} · {num(per.noPrazo.n)} vagas com data</>
                      : "sem datas para comparar"} />
            </div>

            {/* A linha do tempo de uma vaga, em medianas. */}
            <Card className="p-4">
              <p className="mb-3 text-sm font-bold text-foreground">Quanto tempo leva cada passo <span className="font-normal text-muted-foreground">· mediana no período</span></p>
              <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
                <Passo titulo="Solicitação → aprovação" valor={diasTxt(per.diasAprovar.mediana)} n={per.diasAprovar.n} icone={<Clock className="h-4 w-4" />} />
                <ArrowRight className="hidden h-4 w-4 text-muted-foreground md:block" />
                <Passo titulo="Aprovação → vaga aberta" valor={diasTxt(per.diasAbrir.mediana)} n={per.diasAbrir.n} icone={<ClipboardCheck className="h-4 w-4" />} />
                <ArrowRight className="hidden h-4 w-4 text-muted-foreground md:block" />
                <Passo titulo="Solicitação → contratação" valor={diasTxt(per.diasContratar.mediana)} n={per.diasContratar.n} icone={<UserCheck className="h-4 w-4" />} destaque />
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-3">
              <Grafico className="lg:col-span-2" titulo="Solicitadas × contratadas por mês" sub="Solicitadas pela data do pedido; contratadas pela data em que a vaga foi preenchida" vazio={!meses.length}>
                <ResponsiveContainer width="100%" height={270}>
                  <BarChart data={meses} margin={{ top: 18, right: 8, bottom: 0, left: -16 }} barGap={3} barCategoryGap="24%">
                    <CartesianGrid vertical={false} stroke={GRADE} />
                    <XAxis dataKey="rotulo" tick={EIXO} tickLine={false} axisLine={{ stroke: GRADE }} />
                    <YAxis tick={EIXO} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip {...TOOLTIP} />
                    <Legend verticalAlign="top" height={30} iconType="circle" iconSize={8}
                      formatter={(n: string) => <span className="text-xs text-foreground">{n}</span>} />
                    <Bar dataKey="solicitadas" name="Solicitadas" fill={COR_SERIE} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                    <Bar dataKey="contratadas" name="Contratadas" fill={COR_SERIE_2} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </Grafico>
              <Grafico titulo="Tempo até contratar" sub="Dias da solicitação à contratação" vazio={!per.contratadas}>
                <Colunas dados={ateContratar} rotulo="Vagas" altura={270} />
              </Grafico>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Grafico titulo="Motivo das solicitações" sub="Pedidas no período" vazio={!porMotivo.length}>
                <Ranking dados={porMotivo} rotulo="Solicitações" largura={150} />
              </Grafico>
              <Grafico titulo="Contratos que mais pediram" sub="Solicitações no período" vazio={!porContratoPer.length}>
                <Ranking dados={porContratoPer} rotulo="Solicitações" largura={180} />
              </Grafico>
              <Grafico titulo="Tempo parado em cada status" sub="Média em dias, do registro de mudanças de status (todo o histórico)" vazio={!tempos.length}>
                <ResponsiveContainer width="100%" height={Math.max(120, tempos.length * 28 + 16)}>
                  <BarChart data={tempos} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }} barCategoryGap={5}>
                    <CartesianGrid horizontal={false} stroke={GRADE} />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="nome" width={170} tickLine={false} axisLine={false}
                      tick={({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => (
                        <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="hsl(var(--foreground))">
                          <title>{payload.value}</title>{payload.value.length > 26 ? `${payload.value.slice(0, 25)}…` : payload.value}
                        </text>
                      )} />
                    <Tooltip {...TOOLTIP} formatter={(v: number, _n, p) => {
                      const d = p?.payload as { mediana: number; n: number };
                      return [`${diasTxt(v)} (mediana ${diasTxt(d.mediana)} · ${d.n} passagens)`, "Média"];
                    }} />
                    <Bar dataKey="qtd" fill={COR_SERIE} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
                      <LabelList dataKey="qtd" position="right" formatter={(v: number) => diasCurto(v)} style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Grafico>
            </div>
          </Secao>

          {/* ── 3. CANDIDATOS ────────────────────────────────────────── */}
          <Secao titulo="Candidatos" sub={`Funil de agora e candidaturas do período · ${rotuloRecorte}`} icone={<Users className="h-4 w-4" />}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
              <Tile icone={<UserPlus className="h-5 w-5" />} rotulo="Candidaturas" valor={num(cand.candidaturas)}
                    sub={<>{num(cand.paraVaga)} para vaga · {num(cand.bancoTalentos)} banco de talentos</>} />
              <Tile icone={<Users className="h-5 w-5" />} rotulo="No processo agora" valor={num(cand.ativos)} sub="ativos em vagas em aberto" />
              <Tile icone={<UserCheck className="h-5 w-5" />} rotulo="Admitidos" valor={num(cand.admitidos)} sub="enviados à Admissão no período" />
              <Tile icone={<UserX className="h-5 w-5" />} rotulo="Reprovados" valor={num(cand.reprovados)} sub="das candidaturas do período" />
              <Tile icone={<UserMinus className="h-5 w-5" />} rotulo="Desistências" valor={num(cand.desistencias)} sub="das candidaturas do período" />
            </div>
            <Grafico titulo="Candidatos ativos por etapa" sub="Onde estão os candidatos das vagas em aberto, no kanban do processo seletivo" vazio={!cand.ativos}>
              <Colunas dados={cand.funil} rotulo="Candidatos" altura={240} />
            </Grafico>
          </Secao>

          <p className="pb-4 text-center text-[11px] text-muted-foreground">
            Prazo = data de início prevista da solicitação ("imediato" vence no dia do pedido). Em atenção = vence em até {JANELA_ATENCAO} dias.
            Inclui o histórico importado do sistema antigo (Discord) desde jan/2026.
          </p>
        </div>
      )}

      {statusDe && <StatusSolicitacao sol={statusDe} onClose={() => setStatusDe(null)} />}
    </div>
  );
}

function Passo({ titulo, valor, n, icone, destaque }: { titulo: string; valor: string; n: number; icone: ReactNode; destaque?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border p-3", destaque ? "border-transparent text-white" : "border-border bg-muted/40")}
         style={destaque ? { background: MARINHO } : undefined}>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", destaque ? "bg-white/15" : "bg-background text-foreground")}>{icone}</span>
      <div className="min-w-0">
        <p className={cn("text-[11px] font-bold uppercase tracking-wide", destaque ? "text-white/80" : "text-muted-foreground")}>{titulo}</p>
        <p className="text-lg font-extrabold leading-tight">{valor}</p>
        <p className={cn("text-[11px]", destaque ? "text-white/70" : "text-muted-foreground")}>{n ? `${num(n)} vagas medidas` : "sem dados no período"}</p>
      </div>
    </div>
  );
}

function FiltroSelect({ valor, opcoes, todas, largura, onValor }: { valor: string; opcoes: readonly string[]; todas: string; largura: string; onValor: (v: string) => void }) {
  return (
    <Select value={valor || TODAS} onValueChange={(v) => onValor(v === TODAS ? "" : v)}>
      <SelectTrigger className={cn("h-9", largura, valor && "border-primary/50 bg-primary/5 font-semibold")}><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectItem value={TODAS}>{todas}</SelectItem>
        {opcoes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Carregando() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      <Skeleton className="h-20 rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      <Skeleton className="h-96 rounded-xl" />
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Montando o painel…</p>
    </div>
  );
}
