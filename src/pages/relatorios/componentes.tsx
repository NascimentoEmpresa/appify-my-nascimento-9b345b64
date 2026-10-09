import { useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CalendarDays, ChevronDown, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useAnaliseIA, useContratosRelatorio, type FiltroRelatorio, type MsgIA } from "@/hooks/useRelatoriosDiretoria";
import { rotuloMeses } from "@/lib/diretoria/turnover";
import { fmtKpi, periodoDoAtalho, rotuloMes, type Kpi, type RelatorioDados } from "./sistemas";

// =====================================================================
// Diretoria › Relatórios — peças de tela (mig 20261005000006).
// Todas leem o formato padrão das RPCs dir_rel_* (RelatorioDados).
// =====================================================================

const TOM: Record<string, string> = {
  primary: "bg-primary/10 text-primary", success: "bg-success/10 text-success", warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive", info: "bg-info/10 text-info",
};
const COR_GRUPO: Record<string, string> = { aberto: "#f59e0b", concluido: "#16a34a", recusado: "#dc2626" };
const PALETA = ["#2563eb", "#16a34a", "#dc2626", "#f59e0b", "#7c3aed", "#0891b2", "#db2777", "#ea580c"];

// ---- Período ---------------------------------------------------------------

export const ATALHOS = [
  { k: "3m", rotulo: "3 meses" }, { k: "6m", rotulo: "6 meses" }, { k: "12m", rotulo: "12 meses" }, { k: "ano", rotulo: "Este ano" },
];

const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const isoHoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/**
 * Filtro dos relatórios (07/10/2026, mig 20261007000013): atalho (3/6/12
 * meses, este ano), datas livres, OU ano + meses marcados — e o contrato.
 * Ano/meses vira período = o ano (até hoje, se for o atual) + meses.
 */
export function usePeriodo() {
  const [atalho, setAtalho] = useState("12m");
  const [custom, setCustom] = useState<{ de: string; ate: string } | null>(null);
  const [anoMeses, setAnoMesesSt] = useState<{ ano: number; meses: number[] | null } | null>(null);
  const [contrato, setContrato] = useState<string | null>(null);
  const p = anoMeses
    ? { de: `${anoMeses.ano}-01-01`, ate: anoMeses.ano === new Date().getFullYear() ? isoHoje() : `${anoMeses.ano}-12-31` }
    : custom ?? periodoDoAtalho(atalho);
  const filtro: FiltroRelatorio = { ...p, contrato, meses: anoMeses?.meses ?? null };
  return {
    ...filtro, filtro, anoMeses, atalho: anoMeses ? "anomes" : custom ? "custom" : atalho,
    setAtalho: (a: string) => { setCustom(null); setAnoMesesSt(null); setAtalho(a); },
    setCustom: (c: { de: string; ate: string }) => { setAnoMesesSt(null); setCustom(c); },
    setAnoMeses: (ano: number, meses: number[] | null) => { setCustom(null); setAnoMesesSt({ ano, meses: meses?.length ? meses : null }); },
    setContrato,
  };
}

export function SeletorPeriodo({ periodo }: { periodo: ReturnType<typeof usePeriodo> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ATALHOS.map((a) => (
        <Button key={a.k} size="sm" variant={periodo.atalho === a.k ? "default" : "outline"} className="h-8 text-xs" onClick={() => periodo.setAtalho(a.k)}>
          {a.rotulo}
        </Button>
      ))}
      <FiltroAnoMeses periodo={periodo} />
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Input type="date" className="h-8 w-36 text-xs" value={periodo.de} onChange={(e) => e.target.value && periodo.setCustom({ de: e.target.value, ate: periodo.ate })} />
        até
        <Input type="date" className="h-8 w-36 text-xs" value={periodo.ate} onChange={(e) => e.target.value && periodo.setCustom({ de: periodo.de, ate: e.target.value })} />
      </div>
      <FiltroContrato periodo={periodo} />
    </div>
  );
}

/** Ano + um ou vários meses (como no Turn-over). */
function FiltroAnoMeses({ periodo }: { periodo: ReturnType<typeof usePeriodo> }) {
  const anoAtual = new Date().getFullYear();
  const ano = periodo.anoMeses?.ano ?? anoAtual;
  const meses = periodo.anoMeses?.meses ?? null;
  const ultimo = ano < anoAtual ? 12 : new Date().getMonth() + 1;
  const ativo = periodo.atalho === "anomes";
  const alternar = (m: number) => {
    const atual = meses ?? [];
    const prox = atual.includes(m) ? atual.filter((x) => x !== m) : [...atual, m].sort((a, b) => a - b);
    periodo.setAnoMeses(ano, prox.length >= ultimo ? null : prox);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant={ativo ? "default" : "outline"} className="h-8 gap-1.5 text-xs">
          <CalendarDays className="h-3.5 w-3.5" /> {ativo ? `${ano} · ${rotuloMeses(meses)}` : "Mês/ano"} <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="mb-2 flex items-center gap-1.5">
          {[anoAtual, anoAtual - 1, anoAtual - 2].map((a) => (
            <Button key={a} size="sm" variant={ativo && ano === a ? "default" : "outline"} className="h-7 flex-1 text-xs" onClick={() => periodo.setAnoMeses(a, null)}>{a}</Button>
          ))}
        </div>
        <p className="mb-1.5 text-[11px] text-muted-foreground">Ano inteiro, ou marque um ou mais meses:</p>
        <div className="grid grid-cols-4 gap-1.5">
          {MESES_CURTOS.map((nome, i) => {
            const m = i + 1, futuro = m > ultimo, marcado = ativo && !!meses?.includes(m);
            return (
              <button key={nome} type="button" disabled={futuro} onClick={() => (ativo ? alternar(m) : periodo.setAnoMeses(ano, [m]))}
                className={`rounded-md border px-1 py-1.5 text-xs transition ${futuro ? "cursor-not-allowed opacity-40" : marcado ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted"}`}>
                {nome}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{ativo ? `Selecionado: ${ano} · ${rotuloMeses(meses)}.` : "Escolha o ano e, se quiser, os meses."}</p>
      </PopoverContent>
    </Popover>
  );
}

/** Contrato (todos os relatórios, mig 20261007000013). Chamados e Orientações não têm contrato. */
function FiltroContrato({ periodo }: { periodo: ReturnType<typeof usePeriodo> }) {
  const { data: contratos = [] } = useContratosRelatorio();
  return (
    <SearchableSelect
      value={periodo.contrato ?? ""} onChange={(v) => periodo.setContrato(v || null)} allowClear clearValue=""
      options={contratos.map((c) => ({ value: c.id, label: c.encerrado ? `${c.nome} (encerrado)` : c.nome }))}
      placeholder="Todos os contratos" searchPlaceholder="Buscar contrato…" triggerClassName="h-8 w-64 text-xs"
    />
  );
}

// ---- KPIs --------------------------------------------------------------------

export function CartaoKpi({ k, onClick }: { k: Kpi; onClick?: () => void }) {
  return (
    <Card className={onClick ? "cursor-pointer p-4 transition-colors hover:border-primary/50 hover:bg-muted/30" : "p-4"}
          onClick={onClick} role={onClick ? "button" : undefined} title={onClick ? "Clique para ver as vagas" : undefined}>
      <p className="text-xs font-medium text-muted-foreground">{k.rotulo}</p>
      <p className={`mt-1 inline-block rounded-md px-1.5 text-2xl font-bold tabular-nums ${TOM[k.tom] ?? ""}`}>{fmtKpi(k.valor, k.formato)}</p>
      {k.dica && <p className="mt-1 text-[11px] text-muted-foreground">{k.dica}</p>}
    </Card>
  );
}

/** `aoClicar` (opcional, pelo rótulo do KPI): o cartão vira botão — o Vagas — Dashboard abre a lista por trás do número. */
export function LinhaKpis({ kpis, aoClicar }: { kpis: Kpi[]; aoClicar?: Partial<Record<string, () => void>> }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{kpis.map((k) => <CartaoKpi key={k.rotulo} k={k} onClick={aoClicar?.[k.rotulo]} />)}</div>;
}

// ---- Gráficos ------------------------------------------------------------------

/** Evolução mês a mês: barras para contagens, linha para a série com eixo à direita (ex.: taxa de turn-over). */
export function GraficoMensal({ r, altura = 280 }: { r: RelatorioDados; altura?: number }) {
  const dados = r.mensal.dados.map((d) => ({ ...d, rotulo: rotuloMes(d.mes) }));
  // Linha no eixo da direita: a taxa de turn-over (%) e o quadro de ativos
  // (milhares — no mesmo eixo, esmagaria as barras de admitidos/desligados).
  const naDireita = (k: string, eixo?: string) => eixo === "direita" || k === "ativos";
  const direita = r.mensal.series.filter((s) => naDireita(s.chave, s.eixo));
  const pct = direita.some((s) => s.chave === "taxa");
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <ComposedChart data={dados} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="e" tick={{ fontSize: 11 }} allowDecimals={false} />
        {direita.length > 0 && <YAxis yAxisId="d" orientation="right" tick={{ fontSize: 11 }} unit={pct ? "%" : undefined} />}
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {r.mensal.series.map((s, i) => naDireita(s.chave, s.eixo)
          ? <Line key={s.chave} yAxisId="d" type="monotone" dataKey={s.chave} name={s.rotulo} stroke="#0f172a" strokeWidth={2} dot={{ r: 3 }} />
          : <Bar key={s.chave} yAxisId="e" dataKey={s.chave} name={s.rotulo} fill={PALETA[i % PALETA.length]} radius={[3, 3, 0, 0]} />)}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Rosca por status, colorida pelo grupo (andamento / concluído / recusado). */
export function GraficoStatus({ r, altura = 260 }: { r: RelatorioDados; altura?: number }) {
  const itens = r.por_status.slice(0, 10);
  if (!itens.length) return <Vazio />;
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <PieChart>
        <Pie data={itens} dataKey="n" nameKey="nome" innerRadius="55%" outerRadius="85%" paddingAngle={1}>
          {itens.map((s, i) => <Cell key={s.nome} fill={COR_GRUPO[s.grupo] ? shade(COR_GRUPO[s.grupo], i) : PALETA[i % PALETA.length]} />)}
        </Pie>
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} layout="vertical" align="right" verticalAlign="middle" />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Varia um pouco a cor dentro do mesmo grupo para separar fatias vizinhas. */
function shade(hex: string, i: number) {
  const f = 1 - (i % 4) * 0.12;
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.round(((n >> s) & 255) * f).toString(16).padStart(2, "0");
  return `#${c(16)}${c(8)}${c(0)}`;
}

/** Ranking horizontal (top 12 do sistema: contrato, cargo, motivo…). */
export function GraficoRanking({ titulo, itens, cor = "#2563eb" }: { titulo: string; itens: { nome: string; n: number }[]; cor?: string }) {
  const dados = itens.slice(0, 10).map((x) => ({ ...x, curto: x.nome.length > 34 ? x.nome.slice(0, 33) + "…" : x.nome }));
  return (
    <Card className="p-4">
      <p className="mb-2 text-sm font-semibold">{titulo}</p>
      {dados.length === 0 ? <Vazio /> : (
        <ResponsiveContainer width="100%" height={Math.max(140, dados.length * 26 + 20)}>
          <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
            <XAxis type="number" hide allowDecimals={false} />
            <YAxis type="category" dataKey="curto" width={190} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => [v, "Quantidade"]} labelFormatter={(_, p) => p?.[0]?.payload?.nome ?? ""} />
            <Bar dataKey="n" fill={cor} radius={[0, 3, 3, 0]} label={{ position: "right", fontSize: 11 }} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

export function TabelaRecentes({ r }: { r: RelatorioDados }) {
  if (!r.recentes.linhas.length) return null;
  return (
    <Card className="overflow-hidden">
      <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">Últimos registros do período</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            {r.recentes.colunas.map((c) => <th key={c} className="px-3 py-2 font-semibold">{c}</th>)}
          </tr></thead>
          <tbody>
            {r.recentes.linhas.map((l, i) => (
              <tr key={i} className="border-t border-border/60">{l.map((c, j) => <td key={j} className={`px-3 py-1.5 ${j === 1 ? "font-medium" : "text-muted-foreground"}`}>{c ?? "—"}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function Vazio() {
  return <p className="py-8 text-center text-xs text-muted-foreground">Sem dados no período.</p>;
}

// ---- I.A -----------------------------------------------------------------------

/** Análise com I.A + perguntas livres sobre o relatório (Edge diretoria-ia). */
export function PainelIA({ sistema, de, ate, titulo, contrato = null, meses = null }: { sistema: string; de: string; ate: string; titulo: string; contrato?: string | null; meses?: number[] | null }) {
  const ia = useAnaliseIA();
  const [analise, setAnalise] = useState<string | null>(null);
  const [conversa, setConversa] = useState<MsgIA[]>([]);
  const [pergunta, setPergunta] = useState("");

  const gerar = async () => {
    try { setAnalise(await ia.mutateAsync({ sistema, de, ate, contrato, meses, modo: "analise" })); }
    catch (e) { toast.error((e as Error).message); }
  };
  const perguntar = async () => {
    const q = pergunta.trim();
    if (!q) return;
    setPergunta("");
    const historico = conversa;
    setConversa([...historico, { role: "user", content: q }]);
    try {
      const r = await ia.mutateAsync({ sistema, de, ate, contrato, meses, modo: "pergunta", pergunta: q, historico });
      setConversa((c) => [...c, { role: "assistant", content: r }]);
    } catch (e) {
      toast.error((e as Error).message);
      setConversa(historico);
      setPergunta(q);
    }
  };

  return (
    <Card className="border-violet-200 bg-gradient-to-br from-violet-50/70 to-background p-4 dark:border-violet-900 dark:from-violet-950/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-bold"><Sparkles className="h-4 w-4 text-violet-600" /> Análise com I.A — {titulo}</p>
          <p className="text-xs text-muted-foreground">A I.A lê os números deste relatório e do período escolhido. Não inventa dado: o que não está no relatório, ela diz que não sabe.</p>
        </div>
        <Button size="sm" className="gap-1.5 bg-violet-600 hover:bg-violet-700" disabled={ia.isPending} onClick={gerar}>
          {ia.isPending && !conversa.length ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {analise ? "Gerar de novo" : "Gerar análise"}
        </Button>
      </div>

      {analise && (
        <div className="prose prose-sm mt-3 max-w-none rounded-lg border bg-background p-4 dark:prose-invert prose-headings:mb-1 prose-headings:mt-3 prose-h2:text-base prose-ul:my-1">
          <ReactMarkdown>{analise}</ReactMarkdown>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {conversa.map((m, i) => (
          <div key={i} className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "ml-auto bg-violet-600 text-white" : "bg-background border"}`}>
            {m.role === "assistant" ? <div className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown>{m.content}</ReactMarkdown></div> : m.content}
          </div>
        ))}
        {ia.isPending && conversa.length > 0 && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando…</p>}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); perguntar(); }}>
          <Input value={pergunta} onChange={(e) => setPergunta(e.target.value)} placeholder="Pergunte sobre os números (ex.: qual contrato mais preocupa?)" className="bg-background" />
          <Button type="submit" size="icon" disabled={ia.isPending || !pergunta.trim()} title="Perguntar"><Send className="h-4 w-4" /></Button>
        </form>
      </div>
    </Card>
  );
}
