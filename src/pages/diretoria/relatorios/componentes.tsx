import { useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAnaliseIA, type MsgIA } from "@/hooks/useRelatoriosDiretoria";
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

export function usePeriodo() {
  const [atalho, setAtalho] = useState("12m");
  const [custom, setCustom] = useState<{ de: string; ate: string } | null>(null);
  const p = custom ?? periodoDoAtalho(atalho);
  return { ...p, atalho: custom ? "custom" : atalho, setAtalho: (a: string) => { setCustom(null); setAtalho(a); }, setCustom };
}

export function SeletorPeriodo({ periodo }: { periodo: ReturnType<typeof usePeriodo> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ATALHOS.map((a) => (
        <Button key={a.k} size="sm" variant={periodo.atalho === a.k ? "default" : "outline"} className="h-8 text-xs" onClick={() => periodo.setAtalho(a.k)}>
          {a.rotulo}
        </Button>
      ))}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Input type="date" className="h-8 w-36 text-xs" value={periodo.de} onChange={(e) => e.target.value && periodo.setCustom({ de: e.target.value, ate: periodo.ate })} />
        até
        <Input type="date" className="h-8 w-36 text-xs" value={periodo.ate} onChange={(e) => e.target.value && periodo.setCustom({ de: periodo.de, ate: e.target.value })} />
      </div>
    </div>
  );
}

// ---- KPIs --------------------------------------------------------------------

export function CartaoKpi({ k }: { k: Kpi }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{k.rotulo}</p>
      <p className={`mt-1 inline-block rounded-md px-1.5 text-2xl font-bold tabular-nums ${TOM[k.tom] ?? ""}`}>{fmtKpi(k.valor, k.formato)}</p>
      {k.dica && <p className="mt-1 text-[11px] text-muted-foreground">{k.dica}</p>}
    </Card>
  );
}

export function LinhaKpis({ kpis }: { kpis: Kpi[] }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{kpis.map((k) => <CartaoKpi key={k.rotulo} k={k} />)}</div>;
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
export function PainelIA({ sistema, de, ate, titulo }: { sistema: string; de: string; ate: string; titulo: string }) {
  const ia = useAnaliseIA();
  const [analise, setAnalise] = useState<string | null>(null);
  const [conversa, setConversa] = useState<MsgIA[]>([]);
  const [pergunta, setPergunta] = useState("");

  const gerar = async () => {
    try { setAnalise(await ia.mutateAsync({ sistema, de, ate, modo: "analise" })); }
    catch (e) { toast.error((e as Error).message); }
  };
  const perguntar = async () => {
    const q = pergunta.trim();
    if (!q) return;
    setPergunta("");
    const historico = conversa;
    setConversa([...historico, { role: "user", content: q }]);
    try {
      const r = await ia.mutateAsync({ sistema, de, ate, modo: "pergunta", pergunta: q, historico });
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
