import { useMemo, useState, type ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, ComposedChart, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowUpDown, Info, Loader2, Trophy, UserRound, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { useVagasRecrutadoresMov, type FiltroRelatorio } from "@/hooks/useRelatoriosDiretoria";
import {
  META_DIAS_CONTRATAR, corDias, desfechoVaga, diasTotais, etapaDoStatus, fmtDias, mensalVagas, resumoVagas, tituloEtapa, vagaFechada, vagaAbertaAgora,
  type PainelVagas, type Recorte, type VagaPainel,
} from "@/lib/relatorios/vagasPainel";
import {
  FILTRO_RECRUTADORES_PADRAO, METRICAS_RANKING, TIPOS_MOV, idsDaCelula, linhasRecrutadores, movDoRecorte,
  movMensalPorRecrutador, movPorMes, movPorVaga, ordenarRanking, recorteRecrutadores, resumoMov, rotuloRecrutador,
  vagasDoRecrutador,
  type ColunaRecrutador, type FiltroRecrutadores, type LinhaMov, type LinhaRecrutador, type MetricaRanking,
} from "@/lib/relatorios/recrutadoresPainel";
import { rotuloMes, type Kpi } from "./sistemas";
import { LinhaKpis } from "./componentes";

// =====================================================================
// Relatórios › Vagas — DASHBOARD - RECRUTADORES (21/10/2026, mig 20261021000150)
//
// Pedido do Pablo: "um dashboard por recrutador, para ver quem está
// trabalhando mais, com todas as informações e histórico" — com filtros
// todos / por contrato / por recrutador / por vaga, além dos do topo.
//
//   · KPIs do recorte (ou de UM recrutador): os mesmos da Visão geral,
//     calculados por resumoVagas — sem filtro da aba, batem número a número;
//   · ranking: uma linha por responsável pela vaga + quem só movimentou,
//     ordenável; cada número abre as vagas por trás dele (ListaRecorte);
//     clicar no nome abre o detalhe daquela pessoa;
//   · o que cada um fez (movimentações por tipo) e a carga/desfecho;
//   · mês a mês: das vagas dela (coorte do pedido) + as movimentações;
//   · as vagas dela, clicáveis (abrem a aba "Por vaga").
// Contas em src/lib/relatorios/recrutadoresPainel.ts (com teste).
// =====================================================================

const COR_DESFECHO = { contratada: "#16a34a", andamento: "#f59e0b", reprovada: "#dc2626", cancelada: "#6b7280" };
const PALETA = ["#2563eb", "#16a34a", "#db2777", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#64748b"];
const fmtData = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("pt-BR") : "—");
const n1 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 10) / 10);
const pct = (x: number | null) => (x == null ? "—" : `${x.toFixed(0)}%`);
const tituloVaga = (v: Pick<VagaPainel, "id" | "cargo">) => `#${v.id} · ${v.cargo ?? "Vaga"}`;

export function AbaRecrutadores({ p, filtro, meses, onRecorte, onAbrir }: {
  p: PainelVagas; filtro: FiltroRelatorio; meses: number[] | null; onRecorte: (r: Recorte) => void; onAbrir: (v: VagaPainel) => void;
}) {
  const q = useVagasRecrutadoresMov(filtro);
  const mov: LinhaMov[] = useMemo(() => q.data?.linhas ?? [], [q.data]);
  const semMov = !!q.error;
  const [f, setF] = useState<FiltroRecrutadores>(FILTRO_RECRUTADORES_PADRAO);
  const set = (x: Partial<FiltroRecrutadores>) => setF((a) => ({ ...a, ...x }));
  const [metrica, setMetrica] = useState<MetricaRanking>("movimentos");

  // Recorte da aba (contrato/vaga) → ranking de todos; o recrutador abre só o detalhe.
  const pr = useMemo(() => recorteRecrutadores(p, f), [p, f]);
  const linhas = useMemo(() => linhasRecrutadores(pr, mov), [pr, mov]);
  const ranking = useMemo(() => ordenarRanking(linhas, metrica), [linhas, metrica]);
  const sel = f.recrutador ? linhas.find((l) => l.chave === f.recrutador) ?? null : null;
  const pSel = useMemo(() => vagasDoRecrutador(pr, f.recrutador), [pr, f.recrutador]);
  const movSel = useMemo(() => movDoRecorte(mov, pr, f.recrutador), [mov, pr, f.recrutador]);

  const optRecrutador = useMemo(() => ordenarRanking(linhasRecrutadores(p, mov), "vagas")
    .map((l) => ({ value: l.chave, label: `${rotuloRecrutador(l.nome)} (${l.vagas} vaga${l.vagas === 1 ? "" : "s"})` })), [p, mov]);
  const optContrato = useMemo(() => [...new Set(p.vagas.map((v) => (v.contrato ?? "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR")).map((c) => ({ value: c, label: c })), [p.vagas]);
  const optVaga = useMemo(() => [...p.vagas].sort((a, b) => b.id - a.id)
    .map((v) => ({ value: String(v.id), label: `${tituloVaga(v)}${v.contrato ? ` — ${v.contrato}` : ""}` })), [p.vagas]);

  const abrirLista = (titulo: string, ids: number[]) => onRecorte({ tipo: "lista", titulo, ids });
  const celula = (l: LinhaRecrutador, col: ColunaRecrutador, titulo: string) =>
    () => abrirLista(`${rotuloRecrutador(l.nome)} · ${titulo}`, idsDaCelula(pr, mov, l.chave, col));

  const ativo = !!(f.recrutador || f.contrato || f.vaga != null);

  return (
    <>
      <Card className="flex flex-wrap items-end gap-2 p-3">
        <Campo rotulo="Recrutador" className="w-64">
          <SearchableSelect value={f.recrutador ?? ""} onChange={(v) => set({ recrutador: v || null })} options={optRecrutador} placeholder="Todos os recrutadores" allowClear clearValue="" />
        </Campo>
        <Campo rotulo="Contrato" className="min-w-[240px] flex-1">
          <SearchableSelect value={f.contrato ?? ""} onChange={(v) => set({ contrato: v || null })} options={optContrato} placeholder="Todos os contratos" allowClear clearValue="" />
        </Campo>
        <Campo rotulo="Vaga" className="w-72">
          <SearchableSelect value={f.vaga != null ? String(f.vaga) : ""} onChange={(v) => set({ vaga: v ? Number(v) : null })} options={optVaga} placeholder="Todas as vagas" allowClear clearValue="" />
        </Campo>
        {ativo && <Button size="sm" variant="ghost" className="h-9 gap-1 text-xs" onClick={() => setF(FILTRO_RECRUTADORES_PADRAO)}><X className="h-3.5 w-3.5" /> Limpar</Button>}
      </Card>

      {q.isLoading && <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando as movimentações do histórico…</p>}
      {semMov && (
        <p className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          <Info className="h-3.5 w-3.5" /> Movimentações indisponíveis ({(q.error as Error)?.message ?? "erro"}). Os números das vagas seguem valendo.
        </p>
      )}

      <KpisRecorte pSel={pSel} movSel={movSel} sel={sel} nRecrutadores={linhas.filter((l) => !l.semResponsavel && (l.vagas || l.abertasAgora || l.mov.eventos)).length}
        semMov={semMov} onLista={abrirLista} />
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Info className="h-3.5 w-3.5" /> Vaga de cada recrutador = <b>responsável pela vaga</b> (a mesma etiqueta das outras abas). Movimentação = o que a pessoa registrou no histórico do Recrutamento, na data em que fez (desde {fmtData(p.log_desde)}). Vagas do sistema antigo (Discord) não têm responsável: ficam em "Sem responsável".
      </p>

      <Ranking ranking={ranking} metrica={metrica} onMetrica={setMetrica} selecionado={f.recrutador} semMov={semMov}
        onEscolher={(k) => set({ recrutador: f.recrutador === k ? null : k })} celula={celula} />

      <div className="grid gap-4 lg:grid-cols-2">
        <GraficoTrabalho ranking={ranking} semMov={semMov} />
        <GraficoCarga ranking={ranking} />
      </div>

      <MesAMes p={pr} pSel={pSel} movRecorte={movDoRecorte(mov, pr)} movSel={movSel} sel={sel} ranking={ranking} meses={meses} semMov={semMov} />

      {sel ? <VagasDoRecrutador sel={sel} pSel={pSel} movSel={movSel} onAbrir={onAbrir} onTocadas={celula(sel, "tocadas", "vagas em que mexeu")} />
        : <Card className="flex items-center gap-2 p-4 text-xs text-muted-foreground"><UserRound className="h-4 w-4" /> Escolha um recrutador (no filtro ou clicando no nome no ranking) para ver o histórico e a lista de vagas dele.</Card>}
    </>
  );
}

function Campo({ rotulo, className, children }: { rotulo: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      {children}
    </div>
  );
}

function SemDados({ texto = "Sem dados no período." }: { texto?: string }) {
  return <p className="py-8 text-center text-xs text-muted-foreground">{texto}</p>;
}

// ---- KPIs ------------------------------------------------------------------------

function KpisRecorte({ pSel, movSel, sel, nRecrutadores, semMov, onLista }: {
  pSel: PainelVagas; movSel: LinhaMov[]; sel: LinhaRecrutador | null; nRecrutadores: number; semMov: boolean;
  onLista: (titulo: string, ids: number[]) => void;
}) {
  const r = useMemo(() => resumoVagas(pSel), [pSel]);
  const m = useMemo(() => resumoMov(movSel), [movSel]);
  const quem = sel ? rotuloRecrutador(sel.nome) : "Todos";
  const per = pSel.vagas.filter((v) => v.no_periodo);
  const contr = per.filter((v) => desfechoVaga(v) === "contratada");
  const semMovV = semMov ? null : undefined;

  const kpis: Kpi[] = [
    { rotulo: "Vagas sob responsabilidade", valor: r.solicitadas, formato: "n", tom: "primary", dica: `${r.posicoes.toLocaleString("pt-BR")} posições · pedidas no período` },
    { rotulo: "Contratadas", valor: r.contratadas, formato: "n", tom: "success", dica: r.aproveitamentoPct != null ? `${r.aproveitamentoPct.toFixed(0)}% das que já fecharam` : null },
    { rotulo: "Reprovadas / canceladas", valor: r.reprovadas + r.canceladas, formato: "n", tom: "destructive" },
    { rotulo: "Em aberto agora", valor: r.abertasAgora, formato: "n", tom: "warning", dica: `${r.posicoesAbertasAgora} posições · inclui pedidas antes do período` },
    { rotulo: "Tempo médio até contratar", valor: n1(r.tempoMedioContratar), formato: "dias", tom: "info", dica: `Mediana ${fmtDias(r.medianaContratar)} · pedido → Contratado` },
    { rotulo: `Contratadas em até ${META_DIAS_CONTRATAR} dias`, valor: r.noPrazoPct != null ? n1(r.noPrazoPct) : null, formato: "pct", tom: (r.noPrazoPct ?? 0) >= 70 ? "success" : "warning" },
    { rotulo: "Movimentações", valor: semMovV ?? m.eventos, formato: "n", tom: "primary", dica: semMov ? "indisponível" : `${m.diasAtivos} dia(s) com movimento${m.ultimo ? ` · último ${fmtData(m.ultimo)}` : ""}` },
    { rotulo: "Candidatos movimentados", valor: semMovV ?? m.candidatos, formato: "n", tom: "info", dica: semMov ? null : `${m.porTipo.admissao} enviado(s) à admissão · ${m.porTipo.reprovacao} reprovação(ões)` },
    { rotulo: "Desistências de candidatos", valor: r.desistencias, formato: "n", tom: "destructive", dica: "Nas vagas do recorte" },
    sel
      ? { rotulo: "Vagas de outras pessoas em que mexeu", valor: semMovV ?? sel.mov.emVagasDeOutros, formato: "n", tom: "info", dica: semMov ? null : `${sel.mov.vagasTocadas} vaga(s) movimentadas no total` }
      : { rotulo: "Recrutadores no recorte", valor: nRecrutadores, formato: "n", tom: "primary", dica: "Com vaga ou movimentação" },
  ];
  const ids = (vs: VagaPainel[]) => vs.map((v) => v.id);
  const aoClicar: Record<string, () => void> = {
    "Vagas sob responsabilidade": () => onLista(`${quem} · vagas pedidas no período`, ids(per)),
    "Contratadas": () => onLista(`${quem} · contratadas`, ids(contr)),
    "Tempo médio até contratar": () => onLista(`${quem} · contratadas`, ids(contr)),
    "Reprovadas / canceladas": () => onLista(`${quem} · reprovadas/canceladas`, ids(per.filter((v) => ["reprovada", "cancelada"].includes(desfechoVaga(v))))),
    "Em aberto agora": () => onLista(`${quem} · em aberto agora`, ids(pSel.vagas.filter(vagaAbertaAgora))),
    [`Contratadas em até ${META_DIAS_CONTRATAR} dias`]: () => onLista(`${quem} · contratadas em até ${META_DIAS_CONTRATAR} dias`, ids(contr.filter((v) => diasTotais(v, pSel.agora) <= META_DIAS_CONTRATAR))),
    "Desistências de candidatos": () => onLista(`${quem} · vagas com desistência`, ids(per.filter((v) => v.cand.desistiu > 0))),
  };
  if (!semMov) aoClicar["Movimentações"] = () => onLista(`${quem} · vagas movimentadas no período`, [...new Set(movSel.map((x) => x[0]))]);
  return <LinhaKpis kpis={kpis} aoClicar={aoClicar} />;
}

// ---- Ranking --------------------------------------------------------------------

type ColOrd = "nome" | "vagas" | "abertasAgora" | "contratadas" | "reprov" | "aproveitamentoPct" | "tempoMedioContratar" | "noPrazoPct"
  | "candidatos" | "movimentos" | "candMov" | "diasAtivos" | "ultimo";
const valorCol = (l: LinhaRecrutador, c: ColOrd): number | string => {
  switch (c) {
    case "nome": return l.nome;
    case "reprov": return l.reprovadas + l.canceladas;
    case "movimentos": return l.mov.eventos;
    case "candMov": return l.mov.candidatos;
    case "diasAtivos": return l.mov.diasAtivos;
    case "ultimo": return l.mov.ultimo ?? "";
    default: return (l[c] as number | null) ?? -1;
  }
};

function Ranking({ ranking, metrica, onMetrica, selecionado, semMov, onEscolher, celula }: {
  ranking: LinhaRecrutador[]; metrica: MetricaRanking; onMetrica: (m: MetricaRanking) => void; selecionado: string | null; semMov: boolean;
  onEscolher: (chave: string) => void; celula: (l: LinhaRecrutador, col: ColunaRecrutador, titulo: string) => () => void;
}) {
  const [ord, setOrd] = useState<{ col: ColOrd; desc: boolean } | null>(null);
  const linhas = useMemo(() => {
    if (!ord) return ranking;
    return [...ranking].sort((a, b) => {
      const x = valorCol(a, ord.col), y = valorCol(b, ord.col);
      const c = typeof x === "string" ? String(x).localeCompare(String(y), "pt-BR") : (x as number) - (y as number);
      return Number(a.semResponsavel) - Number(b.semResponsavel) || (ord.desc ? -c : c);
    });
  }, [ranking, ord]);
  const pessoas = ranking.filter((l) => !l.semResponsavel);
  const f = METRICAS_RANKING[metrica].f;
  const grafico = pessoas.filter((l) => f(l) > 0).slice(0, 12).map((l) => ({ nome: l.nome, chave: l.chave, n: f(l) }));
  const metricas = (Object.keys(METRICAS_RANKING) as MetricaRanking[]).filter((m) => !semMov || !["movimentos", "candidatos", "diasAtivos"].includes(m));

  const Th = ({ col, children, className = "", title }: { col: ColOrd; children: ReactNode; className?: string; title?: string }) => (
    <th title={title} className={`cursor-pointer select-none px-2 py-2 font-semibold hover:text-foreground ${className}`} onClick={() => setOrd((o) => ({ col, desc: o?.col === col ? !o.desc : col !== "nome" }))}>
      <span className="inline-flex items-center gap-1">{children}{ord?.col === col && <ArrowUpDown className="h-3 w-3" />}</span>
    </th>
  );
  const Num = ({ n, onClick, children, className = "" }: { n: number; onClick?: () => void; children?: ReactNode; className?: string }) => (
    <td className={`px-2 py-1.5 text-right tabular-nums ${className}`}>
      {n ? (onClick ? <button type="button" className="rounded px-1 hover:bg-primary/10 hover:underline" onClick={(e) => { e.stopPropagation(); onClick(); }}>{children ?? n}</button> : (children ?? n)) : "—"}
    </td>
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <p className="mr-auto flex items-center gap-1.5 text-sm font-semibold"><Trophy className="h-4 w-4 text-warning" /> Ranking dos recrutadores — quem está trabalhando mais</p>
        <div className="flex flex-wrap gap-1">
          {metricas.map((m) => (
            <Button key={m} size="sm" variant={metrica === m ? "default" : "outline"} className="h-7 text-xs" onClick={() => { onMetrica(m); setOrd(null); }}>{METRICAS_RANKING[m].titulo}</Button>
          ))}
        </div>
      </div>
      {grafico.length > 0 && (
        <div className="border-b border-border px-4 py-3">
          <ResponsiveContainer width="100%" height={Math.max(160, grafico.length * 30)}>
            <BarChart data={grafico} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }} className="cursor-pointer"
              onClick={(e: { activeTooltipIndex?: number } | null) => { const g = e?.activeTooltipIndex != null ? grafico[e.activeTooltipIndex] : undefined; if (g) onEscolher(g.chave); }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="nome" width={170} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [v.toLocaleString("pt-BR"), METRICAS_RANKING[metrica].titulo]} />
              <Bar dataKey="n" fill="#2563eb" radius={[0, 3, 3, 0]}>
                <LabelList dataKey="n" position="right" fontSize={11} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {linhas.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-2 py-2 text-right">#</th>
              <Th col="nome">Recrutador</Th>
              <Th col="vagas" className="text-right" title="Vagas pedidas no período sob a responsabilidade dela">Vagas</Th>
              <Th col="abertasAgora" className="text-right">Abertas agora</Th>
              <Th col="contratadas" className="text-right">Contratadas</Th>
              <Th col="reprov" className="text-right">Reprov./canc.</Th>
              <Th col="aproveitamentoPct" className="text-right" title="Contratadas ÷ vagas que já fecharam">Aproveit.</Th>
              <Th col="tempoMedioContratar" className="text-right">Tempo médio p/ contratar</Th>
              <Th col="noPrazoPct" className="text-right">Em até {META_DIAS_CONTRATAR} d</Th>
              <Th col="candidatos" className="text-right" title="Candidatos nas vagas dela">Candidatos</Th>
              <Th col="movimentos" className="text-right" title="Movimentações que ELA registrou no histórico">Movimentações</Th>
              <Th col="candMov" className="text-right" title="Candidatos distintos que ela movimentou">Cand. movim.</Th>
              <Th col="diasAtivos" className="text-right">Dias ativos</Th>
              <Th col="ultimo">Último movimento</Th>
            </tr></thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={l.chave} onClick={() => onEscolher(l.chave)} title="Clique para ver o detalhe deste recrutador"
                  className={cn("cursor-pointer border-t border-border/60 hover:bg-muted/40", selecionado === l.chave && "bg-primary/10", l.semResponsavel && "text-muted-foreground")}>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{l.semResponsavel ? "" : i + 1}</td>
                  <td className="max-w-[220px] truncate px-2 py-1.5 font-medium" title={l.nome}>{l.semResponsavel ? <i>Sem responsável</i> : l.nome}</td>
                  <Num n={l.vagas} onClick={celula(l, "vagas", "vagas pedidas no período")}>{l.vagas}{l.posicoes > l.vagas && <span className="text-muted-foreground"> ({l.posicoes})</span>}</Num>
                  <Num n={l.abertasAgora} onClick={celula(l, "abertas", "em aberto agora")}><b className="text-warning">{l.abertasAgora}</b></Num>
                  <Num n={l.contratadas} onClick={celula(l, "contratadas", "contratadas")} className="text-success" />
                  <Num n={l.reprovadas + l.canceladas} onClick={celula(l, "reprovadas", "reprovadas/canceladas")} className="text-destructive" />
                  <td className="px-2 py-1.5 text-right tabular-nums">{pct(l.aproveitamentoPct)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtDias(l.tempoMedioContratar)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {l.noPrazo ? <button type="button" className="rounded px-1 hover:bg-primary/10 hover:underline" onClick={(e) => { e.stopPropagation(); celula(l, "no_prazo", `contratadas em até ${META_DIAS_CONTRATAR} dias`)(); }}>{pct(l.noPrazoPct)}</button> : pct(l.noPrazoPct)}
                  </td>
                  <Num n={l.candidatos} />
                  {semMov ? <td className="px-2 py-1.5 text-right">—</td> : <Num n={l.mov.eventos} onClick={celula(l, "tocadas", "vagas em que mexeu")}><b>{l.mov.eventos.toLocaleString("pt-BR")}</b></Num>}
                  {semMov ? <td className="px-2 py-1.5 text-right">—</td> : <Num n={l.mov.candidatos} />}
                  {semMov ? <td className="px-2 py-1.5 text-right">—</td> : <Num n={l.mov.diasAtivos} />}
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">{fmtData(l.mov.ultimo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <SemDados texto="Nenhuma vaga nem movimentação neste recorte." />}
    </Card>
  );
}

// ---- Gráficos ----------------------------------------------------------------------

function GraficoTrabalho({ ranking, semMov }: { ranking: LinhaRecrutador[]; semMov: boolean }) {
  const dados = ranking.filter((l) => !l.semResponsavel && l.mov.eventos > 0).sort((a, b) => b.mov.eventos - a.mov.eventos).slice(0, 12)
    .map((l) => ({ nome: l.nome, ...l.mov.porTipo }));
  return (
    <Card className="p-4">
      <p className="mb-1 text-sm font-semibold">O que cada um fez no período</p>
      <p className="mb-2 text-[11px] text-muted-foreground">Movimentações registradas no histórico, por tipo.</p>
      {semMov ? <SemDados texto="Movimentações indisponíveis." /> : dados.length ? (
        <ResponsiveContainer width="100%" height={Math.max(220, dados.length * 30 + 40)}>
          <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="nome" width={150} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {TIPOS_MOV.map((t, i) => (
              <Bar key={t.chave} dataKey={t.chave} name={t.titulo} stackId="m" fill={t.cor} radius={i === TIPOS_MOV.length - 1 ? [0, 3, 3, 0] : undefined} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : <SemDados texto="Nenhuma movimentação no período." />}
    </Card>
  );
}

function GraficoCarga({ ranking }: { ranking: LinhaRecrutador[] }) {
  const dados = ranking.filter((l) => l.vagas || l.abertasAgora).sort((a, b) => Number(a.semResponsavel) - Number(b.semResponsavel) || (b.vagas + b.abertasAgora) - (a.vagas + a.abertasAgora)).slice(0, 12)
    .map((l) => ({ nome: rotuloRecrutador(l.nome), contratadas: l.contratadas, abertas: l.abertasAgora, reprovadas: l.reprovadas + l.canceladas }));
  return (
    <Card className="p-4">
      <p className="mb-1 text-sm font-semibold">Carga e desfecho das vagas de cada um</p>
      <p className="mb-2 text-[11px] text-muted-foreground">Contratadas e reprovadas/canceladas das pedidas no período; abertas agora inclui as pedidas antes.</p>
      {dados.length ? (
        <ResponsiveContainer width="100%" height={Math.max(220, dados.length * 30 + 40)}>
          <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="nome" width={150} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="contratadas" name="Contratadas" stackId="c" fill={COR_DESFECHO.contratada} />
            <Bar dataKey="abertas" name="Abertas agora" stackId="c" fill={COR_DESFECHO.andamento} />
            <Bar dataKey="reprovadas" name="Reprovadas/canceladas" stackId="c" fill={COR_DESFECHO.reprovada} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : <SemDados />}
    </Card>
  );
}

function MesAMes({ p, pSel, movRecorte, movSel, sel, ranking, meses, semMov }: {
  p: PainelVagas; pSel: PainelVagas; movRecorte: LinhaMov[]; movSel: LinhaMov[]; sel: LinhaRecrutador | null; ranking: LinhaRecrutador[];
  meses: number[] | null; semMov: boolean;
}) {
  const noFiltro = (mes: string) => !meses || meses.includes(Number(mes.slice(5, 7)));
  const vagasMes = useMemo(() => {
    const mv = new Map(movPorMes(movSel, p.de, p.ate).map((m) => [m.mes, m]));
    return mensalVagas(pSel).filter((m) => noFiltro(m.mes)).map((m) => ({
      ...m, rotulo: rotuloMes(m.mes), tempoMedio: n1(m.tempoMedio), movimentos: semMov ? null : mv.get(m.mes)?.eventos ?? 0, candMov: semMov ? null : mv.get(m.mes)?.candidatos ?? 0,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pSel, movSel, p.de, p.ate, meses, semMov]);
  const top = ranking.filter((l) => !l.semResponsavel && l.mov.eventos > 0).sort((a, b) => b.mov.eventos - a.mov.eventos).slice(0, 6);
  const porPessoa = useMemo(() => movMensalPorRecrutador(movRecorte, top.map((l) => l.chave), p.de, p.ate)
    .filter((m) => noFiltro(m.mes)).map((m) => ({ ...m, rotulo: rotuloMes(m.mes) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [movRecorte, top.map((l) => l.chave).join("|"), p.de, p.ate, meses]);

  return (
    <div className={cn("grid gap-4", !sel && "lg:grid-cols-2")}>
      <Card className="p-4">
        <p className="mb-1 text-sm font-semibold">Mês a mês — {sel ? rotuloRecrutador(sel.nome) : "todos os recrutadores"}</p>
        <p className="mb-2 text-[11px] text-muted-foreground">Barras: das vagas pedidas em cada mês, o desfecho. Linha: movimentações feitas no mês.</p>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={vagasMes} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="n" tick={{ fontSize: 11 }} allowDecimals={false} />
            {!semMov && <YAxis yAxisId="m" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />}
            <Tooltip formatter={(v: number, k: string) => (k === "Tempo médio p/ contratar" ? fmtDias(v) : v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="n" dataKey="contratadas" name="Contratadas" stackId="a" fill={COR_DESFECHO.contratada} />
            <Bar yAxisId="n" dataKey="andamento" name="Em andamento" stackId="a" fill={COR_DESFECHO.andamento} />
            <Bar yAxisId="n" dataKey="reprovadas" name="Reprovadas/canceladas" stackId="a" fill={COR_DESFECHO.reprovada} radius={[3, 3, 0, 0]} />
            {!semMov && <Line yAxisId="m" dataKey="movimentos" name="Movimentações" stroke="#1d4ed8" strokeWidth={2} dot={{ r: 3 }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
      {!sel && (
        <Card className="p-4">
          <p className="mb-1 text-sm font-semibold">Movimentações por mês — os {top.length} mais ativos</p>
          <p className="mb-2 text-[11px] text-muted-foreground">Quanto cada um movimentou em cada mês (pela data do movimento).</p>
          {semMov || !top.length ? <SemDados texto={semMov ? "Movimentações indisponíveis." : "Nenhuma movimentação no período."} /> : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={porPessoa} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {top.map((l, i) => <Line key={l.chave} dataKey={l.chave} name={l.nome} stroke={PALETA[i % PALETA.length]} strokeWidth={2} dot={{ r: 2 }} />)}
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      )}
    </div>
  );
}

// ---- As vagas de UM recrutador ----------------------------------------------------

type OrdLista = "recentes" | "demoradas" | "movimentos";

function VagasDoRecrutador({ sel, pSel, movSel, onAbrir, onTocadas }: {
  sel: LinhaRecrutador; pSel: PainelVagas; movSel: LinhaMov[]; onAbrir: (v: VagaPainel) => void; onTocadas: () => void;
}) {
  const [ord, setOrd] = useState<OrdLista>("recentes");
  const [limite, setLimite] = useState(60);
  const porVaga = useMemo(() => movPorVaga(movSel), [movSel]);
  const linhas = useMemo(() => pSel.vagas.filter((v) => v.no_periodo || !vagaFechada(v))
    .map((v) => ({ v, total: diasTotais(v, pSel.agora), mov: porVaga.get(v.id) }))
    .sort((a, b) => (ord === "demoradas" ? b.total - a.total : ord === "movimentos" ? (b.mov?.eventos ?? 0) - (a.mov?.eventos ?? 0) : b.v.id - a.v.id)), [pSel, porVaga, ord]);
  const nome = rotuloRecrutador(sel.nome);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <p className="mr-auto text-sm font-semibold">{linhas.length} vaga(s) de {nome} <span className="font-normal text-muted-foreground">— pedidas no período ou em aberto agora · clique para abrir o dashboard da vaga</span></p>
        {sel.mov.emVagasDeOutros > 0 && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onTocadas}>Todas as vagas em que mexeu ({sel.mov.vagasTocadas})</Button>}
        <div className="flex gap-1">
          {(["recentes", "demoradas", "movimentos"] as OrdLista[]).map((o) => (
            <Button key={o} size="sm" variant={ord === o ? "default" : "outline"} className="h-7 text-xs" onClick={() => setOrd(o)}>
              {o === "recentes" ? "Mais recentes" : o === "demoradas" ? "Mais demoradas" : "Mais movimentadas"}
            </Button>
          ))}
        </div>
      </div>
      {linhas.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">Vaga</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2">Pedida em</th>
              <th className="px-3 py-2 text-right" title="Aberta: desde o pedido até hoje · fechada: até fechar">Tempo</th>
              <th className="px-3 py-2 text-right">Cand.</th><th className="px-3 py-2 text-right">Desist.</th>
              <th className="px-3 py-2 text-right" title={`Movimentações feitas por ${nome} nesta vaga`}>Movim.</th>
              <th className="px-3 py-2">Urgência</th><th className="px-3 py-2">Solicitante</th>
            </tr></thead>
            <tbody>
              {linhas.slice(0, limite).map(({ v, total, mov }) => {
                const d = desfechoVaga(v);
                return (
                  <tr key={v.id} className="cursor-pointer border-t border-border/60 hover:bg-muted/40" onClick={() => onAbrir(v)}>
                    <td className="max-w-[300px] px-3 py-1.5">
                      <p className="truncate font-medium text-primary">{tituloVaga(v)}{v.qtd > 1 && <span className="text-muted-foreground"> ×{v.qtd}</span>}</p>
                      <p className="truncate text-[10px] text-muted-foreground" title={v.contrato ?? ""}>{v.contrato ?? "—"}{v.cidade ? ` · ${v.cidade}` : ""}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-[11px] font-medium" style={{ color: COR_DESFECHO[d] }}>
                      {d === "andamento" ? tituloEtapa(etapaDoStatus(v.status)) : d === "contratada" ? "Contratada" : d === "reprovada" ? "Reprovada" : "Cancelada"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground">{fmtData(v.criada)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums" style={vagaFechada(v) ? undefined : { color: corDias(total) }}>{fmtDias(total, 0)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{v.cand.total || "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{v.cand.desistiu || "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{mov ? <span title={`${mov.candidatos} candidato(s)`}>{mov.eventos}</span> : "—"}</td>
                    <td className="max-w-[140px] truncate px-3 py-1.5 text-muted-foreground">{v.urgencia ?? "—"}</td>
                    <td className="max-w-[140px] truncate px-3 py-1.5 text-muted-foreground">{v.solicitante ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {linhas.length > limite && (
            <div className="border-t border-border p-2 text-center">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setLimite((l) => l + 200)}>Mostrar mais ({linhas.length - limite} restantes)</Button>
            </div>
          )}
        </div>
      ) : <SemDados texto={`Nenhuma vaga de ${nome} neste recorte.`} />}
    </Card>
  );
}
