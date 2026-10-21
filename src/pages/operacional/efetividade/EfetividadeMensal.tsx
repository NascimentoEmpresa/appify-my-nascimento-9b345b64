// =====================================================================
// 6. EFETIVIDADE MENSAL (/app/operacional/efetividade/mensal) — 21/10/2026
//
// O painel da efetividade de TODOS os contratos, mês a mês. Mês fechado = o
// mês inteiro; mês corrente = do dia 1 até ONTEM (hoje ainda não tem os
// pontos). A regra do dia é a mesma das outras abas (avaliarTodos); o recorte,
// a soma, os filtros e o Excel moram em src/lib/efetividadeMensal.ts.
//
// Velocidade: um RPC ope_efet_base por mês (a empresa toda, em paralelo, com
// a mesma chave de cache das outras abas; mês fechado fica 1h em cache). Cada
// mês é avaliado UMA vez (colaborador × dia) e guardado no estado; trocar
// filtro só refiltra e soma os resumos por colaborador — não reavalia dia
// nenhum. Medido em 21/10/2026: 0,7 s para avaliar um mês de 2.400 pessoas,
// 1,4 ms para refiltrar (antes do formatador de data em cache: 5,5 s).
//
// Os filtros das outras abas (?c=empresa-filial, ?enc=, ?t=) entram como
// filtro inicial — quem vem do Painel do Dia de um contrato cai nele.
// =====================================================================
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { FiltroContratos } from "@/components/solicitacoes/FiltroContratos";
import {
  BarChart3, Building2, CalendarRange, FileSpreadsheet, Info, Loader2, RotateCcw, Search, ShieldAlert, Stethoscope, Table2,
  TrendingUp, UserCheck, UserMinus, UserX, Users,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useEfetBasesPeriodos, useEfetOcorrencias } from "@/hooks/useEfetividade";
import {
  agoraBrasilia, chaveContrato, chavePosto, fmtDataBR, pct, prepararColaborador, ROTULO_TURNO,
  type BaseEfet, type ContratoEfet, type Ocorrencia, type Resumo, type Turno,
} from "@/lib/efetividade";
import {
  apurarMes, assinaturaOcorrencias, faixaEfetividade, filtrarApuracao, mesesAte, mesPadrao, montarPlanilhaEfetividade, nomeMes, porContrato, porPosto, recorteDoMes,
  rotuloMes, serieDoMes, totalDoMes, FILTROS_VAZIOS, ROTULO_FAIXA,
  type ApuracaoColab, type FaixaEfet, type FiltrosMensal, type RecorteMes, type TotalMes,
} from "@/lib/efetividadeMensal";
import { CabecalhoEfetividade, CelulaPct, Erro, Kpi, Paginacao, Secao, Vazio } from "./shared";

const SEM_OCORRENCIAS: Ocorrencia[] = [];
const MESES_NO_SELETOR = 24;
const POR_PAGINA = 50;

const COR_FAIXA: Record<FaixaEfet, string> = {
  normal: "hsl(var(--success))", atencao: "hsl(var(--warning))", critico: "hsl(var(--destructive))", sem_dados: "hsl(var(--muted-foreground))",
};
const pp = (v: number | null | undefined) => (v == null ? null : +(v * 100).toFixed(1));
const tooltipStyle = { fontSize: 12, borderRadius: 8, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" };
const eixo = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

type Visao = "contratos" | "postos" | "colaboradores";
type ColOrdem = "titulo" | "colaboradores" | "previsto" | "presentes" | "faltas" | "atestados" | "afastamentos" | "ferias" | "coberturas" | "descobertos" | "efetividade";

interface Apurado { base: BaseEfet; assinatura: string; ap: ApuracaoColab[] }

interface LinhaTabela {
  chave: string; titulo: string; sub: string; colaboradores: number | null;
  r: Resumo; coberturas: number; descobertos: number; contrato: string;
}

export default function EfetividadeMensal() {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const hoje = agoraBrasilia().data;
  const mesCorrente = hoje.slice(0, 7);
  const mes = sp.get("m") && recorteDoMes(sp.get("m")!, hoje) ? sp.get("m")! : mesPadrao(hoje);
  const setMes = (m: string) => { const n = new URLSearchParams(sp); n.set("m", m); setSp(n, { replace: true }); };

  const [nMeses, setNMeses] = useState(3);
  const [f, setF] = useState<FiltrosMensal>(() => ({
    ...FILTROS_VAZIOS, encarregado: sp.get("enc"), turno: (sp.get("t") as Turno | null) || null,
  }));
  const [pagina, setPagina] = useState(1);
  const set = (patch: Partial<FiltrosMensal>) => { setF((x) => ({ ...x, ...patch })); setPagina(1); };
  // A conta pesada segue o filtro "atrasada": digitar na busca não engasga.
  const fx = useDeferredValue(f);
  const [visao, setVisao] = useState<Visao>("contratos");
  const [grafico, setGrafico] = useState<"mes" | "dia">("mes");
  const [ordem, setOrdem] = useState<{ col: ColOrdem; asc: boolean }>({ col: "efetividade", asc: true });

  // ---- Dados: um período por mês (o selecionado é o último) ----
  const recortes = useMemo(
    () => mesesAte(mes, nMeses).map((m) => recorteDoMes(m, hoje)).filter((r): r is RecorteMes => !!r),
    [mes, nMeses, hoje],
  );
  const recorte = recortes[recortes.length - 1] ?? null;
  const bases = useEfetBasesPeriodos(recortes);
  const ocs = useEfetOcorrencias(recortes[0]?.ini ?? null, recorte?.fim ?? null);
  const ocsData = ocs.data ?? (ocs.error ? SEM_OCORRENCIAS : null);

  // Avalia cada mês uma vez só (colaborador × dia, ~0,7 s a empresa toda) e
  // UM mês por vez, num setTimeout — o selecionado primeiro, depois do mais
  // novo ao mais antigo —, para a tela pintar entre um e outro em vez de
  // travar com 12 meses. Reavalia só se o ponto do mês ou as ocorrências
  // DAQUELE mês mudarem (a lista de ocorrências cobre todos os meses e é
  // relida de minuto em minuto).
  const [apurados, setApurados] = useState<Map<string, Apurado>>(() => new Map());
  const chaveDados = bases.map((b) => b.dataUpdatedAt).join("|");
  useEffect(() => {
    if (!ocsData) return;
    const pendente = recortes.map((r, i) => ({ r, base: bases[i]?.data }))
      .reverse()
      .find(({ r, base }) => {
        if (!base) return false;
        const a = apurados.get(r.mes);
        return !a || a.base !== base || a.assinatura !== assinaturaOcorrencias(ocsData, r);
      });
    if (!pendente) return;
    const id = window.setTimeout(() => {
      const { r, base } = pendente;
      const ap = apurarMes(base!.colaboradores.map(prepararColaborador), r.ini, r.fim, base!.sincronizado_ate, ocsData);
      setApurados((m) => new Map(m).set(r.mes, { base: base!, assinatura: assinaturaOcorrencias(ocsData, r), ap }));
    }, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recortes, chaveDados, ocsData, apurados]);
  // Enquanto reavalia (ocorrência nova), mostra a apuração anterior do mesmo ponto — sem piscar.
  const apuracoes = useMemo(
    () => recortes.map((r, i) => { const a = apurados.get(r.mes); return a && a.base === bases[i]?.data ? a.ap : null; }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recortes, apurados, chaveDados],
  );

  const baseSel = bases[bases.length - 1]?.data ?? null;
  const apSel = apuracoes[apuracoes.length - 1] ?? null;
  const sincAte = baseSel?.sincronizado_ate ?? null;
  const contratos = useMemo(() => {
    // Os contratos de todos os meses carregados (o mais novo vence): contrato
    // encerrado em agosto ainda tem nome e empresa em agosto.
    const m = new Map<string, ContratoEfet>();
    for (const b of bases) for (const c of b.data?.contratos ?? []) m.set(chaveContrato(c.empresa, c.filial), c);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDados]);

  // ---- Filtro aplicado ----
  // Contrato vindo das outras abas (?c=empresa-filial), aplicado uma vez quando os contratos chegam.
  const [contratoUrl, setContratoUrl] = useState(() => sp.get("c"));
  useEffect(() => {
    const k = contratoUrl ? contratos.get(contratoUrl) : null;
    if (!k) return;
    setF((x) => ({ ...x, contratos: [k.nome] }));
    setContratoUrl(null);
  }, [contratoUrl, contratos]);

  const apF = useMemo(() => (apSel ? filtrarApuracao(apSel, fx, contratos) : []), [apSel, fx, contratos]);
  const total = useMemo(() => totalDoMes(apF), [apF]);
  const evolucao = useMemo(() => recortes.map((r, i) => {
    const ap = apuracoes[i];
    return { recorte: r, total: ap ? totalDoMes(filtrarApuracao(ap, fx, contratos)) : null };
  }), [recortes, apuracoes, fx, contratos]);
  const anterior: TotalMes | null = evolucao.length > 1 ? evolucao[evolucao.length - 2].total : null;

  const linhasContrato = useMemo(() => porContrato(apF), [apF]);
  const serieDia = useMemo(() => (recorte ? serieDoMes(apF, recorte.ini, recorte.fim) : []), [apF, recorte]);

  // ---- Opções dos filtros (do mês, sem os outros filtros) ----
  const opcoes = useMemo(() => {
    const empresas = new Map<string, string>();
    const postos = new Map<string, { label: string; hint: string }>();
    const cargos = new Set<string>();
    const encarregados = new Map<string, string>();
    for (const a of apSel ?? []) {
      const c = a.p.c;
      const k = contratos.get(chaveContrato(c.empresa, c.filial));
      empresas.set(String(c.empresa), k?.empresa_nome ?? `Empresa ${c.empresa}`);
      if (!f.contratos.length || f.contratos.includes(c.contrato)) postos.set(chavePosto(c), { label: c.posto_nome, hint: c.contrato });
      if (c.cargo) cargos.add(c.cargo);
      for (const e of k?.encarregados ?? []) encarregados.set(String(e.id), e.nome);
    }
    const ord = (xs: { value: string; label: string; hint?: string }[]) => xs.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    return {
      empresas: ord([...empresas].map(([value, label]) => ({ value, label: `${value} · ${label}` }))),
      postos: ord([...postos].map(([value, x]) => ({ value, ...x }))),
      cargos: ord([...cargos].map((x) => ({ value: x, label: x }))),
      encarregados: ord([...encarregados].map(([value, label]) => ({ value, label }))),
    };
  }, [apSel, contratos, f.contratos]);

  const opcMeses = useMemo(() => mesesAte(mesCorrente, MESES_NO_SELETOR).reverse()
    .map((m) => ({ m, r: recorteDoMes(m, hoje) }))
    .filter((x) => x.r)
    .map(({ m, r }) => ({ value: m, label: nomeMes(m), hint: r!.fechado ? "mês fechado" : `até ${fmtDataBR(r!.fim)}` })), [mesCorrente, hoje]);

  const filtrosTexto = useMemo(() => {
    const t: string[] = [];
    const rot = (xs: { value: string; label: string }[], v: string | null) => xs.find((x) => x.value === v)?.label ?? v;
    // O filtro APLICADO (fx) — é ele que vai para o Excel junto com as linhas.
    if (fx.contratos.length) t.push(`Contratos: ${fx.contratos.join(", ")}`);
    if (fx.empresa) t.push(`Empresa: ${rot(opcoes.empresas, fx.empresa)}`);
    if (fx.encarregado) t.push(`Encarregado: ${rot(opcoes.encarregados, fx.encarregado)}`);
    if (fx.posto) t.push(`Posto: ${rot(opcoes.postos, fx.posto)}`);
    if (fx.cargo) t.push(`Cargo: ${fx.cargo}`);
    if (fx.turno) t.push(`Turno: ${ROTULO_TURNO[fx.turno]}`);
    if (fx.faixa) t.push(`Faixa de efetividade: ${ROTULO_FAIXA[fx.faixa]}`);
    if (fx.busca.trim()) t.push(`Busca: ${fx.busca.trim()}`);
    return t;
  }, [fx, opcoes]);
  const temFiltro = JSON.stringify(f) !== JSON.stringify(FILTROS_VAZIOS);

  // ---- Tabela ----
  const linhasTabela: LinhaTabela[] = useMemo(() => {
    const enc = (empresa: number, filial: number) => contratos.get(chaveContrato(empresa, filial))?.encarregados.map((e) => e.nome).join(", ") ?? "";
    if (visao === "contratos") return linhasContrato.map((l) => ({
      chave: l.chave, titulo: l.rotulo, sub: enc(l.itens[0].p.c.empresa, l.itens[0].p.c.filial) || "Sem encarregado na Hierarquia",
      colaboradores: l.colaboradores, r: l, coberturas: l.coberturas, descobertos: l.descobertos, contrato: l.rotulo,
    }));
    if (visao === "postos") return porPosto(apF).map((l) => ({
      chave: l.chave, titulo: l.rotulo, sub: l.itens[0].p.c.contrato, colaboradores: l.colaboradores, r: l,
      coberturas: l.coberturas, descobertos: l.descobertos, contrato: l.itens[0].p.c.contrato,
    }));
    return apF.map((a) => ({
      chave: String(a.p.c.id), titulo: a.p.c.nome, sub: `${a.p.c.cadastro ?? ""} · ${a.p.c.cargo ?? "—"} · ${a.p.c.contrato}`,
      colaboradores: null, r: a.resumo, coberturas: a.coberturas, descobertos: a.descobertos, contrato: a.p.c.contrato,
    }));
  }, [visao, linhasContrato, apF, contratos]);

  const ordenadas = useMemo(() => {
    const v = (l: LinhaTabela): number | string => {
      if (ordem.col === "titulo") return l.titulo;
      if (ordem.col === "colaboradores") return l.colaboradores ?? 0;
      if (ordem.col === "coberturas") return l.coberturas;
      if (ordem.col === "descobertos") return l.descobertos;
      // Sem previsto vai para o fim nos dois sentidos.
      if (ordem.col === "efetividade") return l.r.efetividade ?? (ordem.asc ? 9 : -9);
      return l.r[ordem.col];
    };
    return [...linhasTabela].sort((a, b) => {
      const x = v(a), y = v(b);
      const c = typeof x === "string" ? x.localeCompare(String(y), "pt-BR") : x - (y as number);
      return (ordem.asc ? c : -c) || a.titulo.localeCompare(b.titulo, "pt-BR");
    });
  }, [linhasTabela, ordem]);
  const paginaAtual = Math.min(pagina, Math.max(1, Math.ceil(ordenadas.length / POR_PAGINA)));

  const graficoContratos = useMemo(() => [...linhasContrato].filter((l) => l.efetividade != null)
    .sort((a, b) => a.efetividade! - b.efetividade!).slice(0, 15)
    .map((l) => ({ nome: l.rotulo, efetividade: pp(l.efetividade), faixa: l.faixa })), [linhasContrato]);
  const graficoMeses = evolucao.map(({ recorte: r, total: t }) => ({
    rotulo: rotuloMes(r.mes) + (r.fechado ? "" : "*"),
    efetividade: pp(t?.efetividade), faixa: faixaEfetividade(t?.efetividade),
    faltas: t && t.previsto - t.aguardando > 0 ? +((t.faltas / (t.previsto - t.aguardando)) * 100).toFixed(1) : null,
  }));
  const graficoDias = serieDia.filter((s) => s.previsto - s.aguardando > 0).map((s) => ({
    rotulo: `${s.data.slice(8, 10)}/${s.data.slice(5, 7)}`, efetividade: pp(s.efetividade),
    faltas: +((s.faltas / (s.previsto - s.aguardando)) * 100).toFixed(1),
  }));

  const contratosCriticos = linhasContrato.filter((l) => l.faixa === "critico").length;
  const carregandoTendencia = apuracoes.some((a) => !a);
  const erroSel = (bases[bases.length - 1]?.error ?? null) as Error | null;
  const erro = (erroSel ?? bases.find((b) => b.error)?.error ?? null) as Error | null;
  // O que falta para o mês selecionado aparecer (o ponto chega do banco, depois a conta).
  const etapaSel = apSel ? null : !baseSel ? "lendo" : "calculando";

  const exportar = () => {
    if (!recorte || !apSel) return;
    const wb = montarPlanilhaEfetividade({
      recorte, sincronizadoAte: sincAte, filtrosTexto, apuracao: apF, contratos,
      evolucao: evolucao.filter((e): e is { recorte: RecorteMes; total: TotalMes } => !!e.total),
    });
    XLSX.writeFile(wb, `efetividade_${recorte.mes}${temFiltro ? "_filtrado" : ""}.xlsx`);
  };

  const ordenar = (col: ColOrdem) => setOrdem((o) => ({ col, asc: o.col === col ? !o.asc : col === "titulo" || col === "efetividade" }));
  const th = (col: ColOrdem, rotulo: string, className?: string) => (
    <th className={cn("cursor-pointer select-none whitespace-nowrap p-2 hover:text-foreground", className)} onClick={() => ordenar(col)}
      aria-sort={ordem.col === col ? (ordem.asc ? "ascending" : "descending") : undefined}>
      {rotulo}{ordem.col === col ? (ordem.asc ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div>
      <CabecalhoEfetividade titulo="Efetividade Mensal" icone={CalendarRange}
        subtitulo="A efetividade de todos os contratos, mês a mês, com o relatório completo em Excel."
        onAtualizar={() => qc.invalidateQueries({ queryKey: ["efetividade"] })} atualizando={bases.some((b) => b.isFetching)}
        extra={<Button className="gap-2" onClick={exportar} disabled={!apSel || !apF.length}><FileSpreadsheet className="h-4 w-4" />Exportar Excel</Button>} />

      {/* ---- Filtros ---- */}
      <Card className="mb-4 space-y-3 p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 lg:items-end">
          <div className="space-y-1 text-xs font-semibold">Mês
            <SearchableSelect value={mes} onChange={(v) => { if (v) { setMes(v); setPagina(1); } }} options={opcMeses} placeholder="Mês" searchPlaceholder="Buscar mês…" />
          </div>
          <div className="space-y-1 text-xs font-semibold">Empresa
            <SearchableSelect value={f.empresa ?? ""} onChange={(v) => set({ empresa: v || null })} options={opcoes.empresas} allowClear placeholder="Todas" searchPlaceholder="Buscar empresa…" />
          </div>
          <div className="space-y-1 text-xs font-semibold">Encarregado
            <SearchableSelect value={f.encarregado ?? ""} onChange={(v) => set({ encarregado: v || null })} options={opcoes.encarregados} allowClear placeholder="Todos" searchPlaceholder="Buscar encarregado…" />
          </div>
          <div className="space-y-1 text-xs font-semibold">Posto
            <SearchableSelect value={f.posto ?? ""} onChange={(v) => set({ posto: v || null })} options={opcoes.postos} allowClear placeholder="Todos" searchPlaceholder="Buscar posto…" />
          </div>
          <div className="space-y-1 text-xs font-semibold">Cargo
            <SearchableSelect value={f.cargo ?? ""} onChange={(v) => set({ cargo: v || null })} options={opcoes.cargos} allowClear placeholder="Todos" searchPlaceholder="Buscar cargo…" />
          </div>
          <div className="space-y-1 text-xs font-semibold">Turno
            <SearchableSelect value={f.turno ?? ""} onChange={(v) => set({ turno: (v as Turno) || null })} allowClear placeholder="Todos"
              options={(Object.keys(ROTULO_TURNO) as Turno[]).map((t) => ({ value: t, label: ROTULO_TURNO[t] }))} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FiltroContratos linhas={apSel ?? []} campo={(a: ApuracaoColab) => a.p.c.contrato} selecionados={f.contratos}
            onChange={(contratos) => set({ contratos, posto: null })} />
          <div className="flex rounded-md border p-0.5 text-xs">
            {([null, "normal", "atencao", "critico", "sem_dados"] as (FaixaEfet | null)[]).map((x) => (
              <button key={x ?? "todas"} onClick={() => set({ faixa: x })}
                className={cn("rounded px-2 py-1.5 font-semibold", f.faixa === x ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {x ? ROTULO_FAIXA[x] : "Todas as faixas"}
              </button>
            ))}
          </div>
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={f.busca} onChange={(e) => set({ busca: e.target.value })} placeholder="Colaborador ou cadastro…" className="pl-8" />
          </div>
          <Button variant="outline" className="gap-2" disabled={!temFiltro} onClick={() => { setF(FILTROS_VAZIOS); setPagina(1); }}><RotateCcw className="h-4 w-4" />Limpar</Button>
        </div>
      </Card>

      {recorte && (
        <Card className="mb-4 flex items-start gap-3 border-info/40 bg-info/5 p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          <p>
            <b>{nomeMes(recorte.mes)}</b>: {fmtDataBR(recorte.ini)} a {fmtDataBR(recorte.fim)}
            {recorte.fechado ? " (mês fechado)." : <> — mês corrente, <b>até ontem</b>: o dia de hoje ainda não tem os pontos.</>}
            {sincAte && sincAte < recorte.fim && <> O ponto da Senior vai até <b>{fmtDataBR(sincAte)}</b>; os dias seguintes ficam como aguardando e não entram na conta.</>}
            {" "}Efetividade = presentes ÷ efetivo previsto (presentes + faltas + atestados + afastamentos); férias e folgas não entram.
            {recorte.mes < mesCorrente && (
              // A Senior só diz a situação de HOJE (EMPREGADOS."Situação" + "Data Afastamento"):
              // não há histórico de afastamento no banco. Quem esteve de atestado
              // em agosto e já voltou aparece em agosto pelas batidas que não tem.
              <span className="text-muted-foreground"> Em mês passado, atestado e afastamento vêm da situação atual na Senior: quem se afastou e já voltou conta pelas batidas (sem ponto vira falta ou sem registro).</span>
            )}
          </p>
        </Card>
      )}
      <Erro erro={erro} />

      {!recorte || erroSel ? (
        !erroSel && <Vazio texto="Nenhum dia apurado neste mês ainda." />
      ) : etapaSel ? (
        <Card className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {etapaSel === "lendo"
            ? `Lendo o ponto da Senior de ${nomeMes(recorte.mes)} (${recorte.dias} dias, todos os contratos)…`
            : `Calculando a efetividade de ${nomeMes(recorte.mes)}…`}
        </Card>
      ) : (
        <div className="space-y-4">
          {/* ---- KPIs ---- */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={BarChart3} rotulo={`Efetividade · ${rotuloMes(recorte.mes)}`} valor={pp(total.efetividade)} sufixo="%"
              anterior={pp(anterior?.efetividade)} formatoDelta="pp" tom={total.efetividade == null ? "muted" : total.efetividade >= 0.95 ? "success" : total.efetividade >= 0.91 ? "warning" : "destructive"}
              dica={anterior ? "vs. mês anterior" : "meta: 95%"} />
            <Kpi icon={Building2} rotulo="Contratos" valor={linhasContrato.length} tom="primary"
              dica={`${contratosCriticos} abaixo de 91% · ${total.colaboradores.toLocaleString("pt-BR")} colaboradores`}
              onClick={() => set({ faixa: f.faixa === "critico" ? null : "critico" })} ativo={f.faixa === "critico"} />
            <Kpi icon={Users} rotulo="Efetivo previsto (dias-pessoa)" valor={total.previsto - total.aguardando} tom="info"
              dica={`média de ${Math.round((total.previsto - total.aguardando) / recorte.dias).toLocaleString("pt-BR")} por dia`} />
            <Kpi icon={UserCheck} rotulo="Presenças (dias-pessoa)" valor={total.presentes} tom="success" dica={`${total.atrasos.toLocaleString("pt-BR")} com atraso`} />
            <Kpi icon={UserX} rotulo="Faltas" valor={total.faltas} tom="destructive"
              dica={total.previsto - total.aguardando > 0 ? `${pct(total.faltas / (total.previsto - total.aguardando))} do previsto` : undefined} />
            <Kpi icon={Stethoscope} rotulo="Atestados (dias)" valor={total.atestados} tom="violet" />
            <Kpi icon={UserMinus} rotulo="Afastamentos (dias)" valor={total.afastamentos} tom="warning" dica={`férias: ${total.ferias.toLocaleString("pt-BR")} dia(s)`} />
            <Kpi icon={ShieldAlert} rotulo="Postos descobertos (dias)" valor={total.descobertos} tom="destructive" dica={`${total.coberturas} cobertura(s) com ponto confirmado`} />
          </div>

          {/* ---- Gráficos ---- */}
          <div className="grid gap-4 xl:grid-cols-2">
            <Secao titulo={grafico === "mes" ? "Efetividade por Mês" : `Efetividade por Dia · ${rotuloMes(recorte.mes)}`} icone={TrendingUp}
              sub={grafico === "mes" ? "* mês corrente, até ontem · linha tracejada = meta de 95%" : "Só dias com efetivo previsto"}
              acoes={<div className="flex items-center gap-2">
                {grafico === "mes" && (
                  <select value={nMeses} onChange={(e) => setNMeses(+e.target.value)} className="h-7 rounded-md border bg-background px-1 text-xs">
                    {[3, 6, 12].map((n) => <option key={n} value={n}>{n} meses</option>)}
                  </select>
                )}
                <div className="flex rounded-md border p-0.5 text-xs">
                  {(["mes", "dia"] as const).map((v) => <button key={v} onClick={() => setGrafico(v)} className={cn("rounded px-2 py-1 font-semibold", grafico === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{v === "mes" ? "Mês" : "Dia"}</button>)}
                </div>
              </div>}>
              <div className="relative h-72 p-2">
                {grafico === "mes" && carregandoTendencia && (
                  <span className="absolute right-4 top-2 z-10 flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />carregando meses…</span>
                )}
                <ResponsiveContainer width="100%" height="100%">
                  {grafico === "mes" ? (
                    <BarChart data={graficoMeses} margin={{ top: 16, right: 16, left: -8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="rotulo" tick={eixo} tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 100]} tick={eixo} tickLine={false} axisLine={false} unit="%" />
                      <Tooltip formatter={(v: number) => (v == null ? "—" : `${v.toLocaleString("pt-BR")}%`)} contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <ReferenceLine y={95} stroke="hsl(var(--success))" strokeDasharray="4 4" />
                      <Bar dataKey="efetividade" name="Efetividade" radius={[4, 4, 0, 0]} label={{ position: "top", fontSize: 11, formatter: (v: number) => (v == null ? "" : `${v}%`) }}>
                        {graficoMeses.map((g, i) => <Cell key={i} fill={COR_FAIXA[g.faixa]} />)}
                      </Bar>
                      <Bar dataKey="faltas" name="Faltas (%)" fill="hsl(var(--destructive) / 0.45)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  ) : (
                    <LineChart data={graficoDias} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="rotulo" tick={eixo} tickLine={false} axisLine={false} minTickGap={12} />
                      <YAxis domain={[0, 100]} tick={eixo} tickLine={false} axisLine={false} unit="%" />
                      <Tooltip formatter={(v: number) => `${v?.toLocaleString("pt-BR")}%`} contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <ReferenceLine y={95} stroke="hsl(var(--success))" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="efetividade" name="Efetividade" stroke="hsl(var(--success))" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="faltas" name="Faltas (%)" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
            </Secao>

            <Secao titulo="Contratos com Menor Efetividade" icone={BarChart3} sub={`Os ${graficoContratos.length} piores de ${rotuloMes(recorte.mes)} · clique para filtrar`}>
              {graficoContratos.length ? (
                <div className="p-2" style={{ height: Math.max(220, graficoContratos.length * 26 + 40) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={graficoContratos} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 0 }}
                      onClick={(e) => { const n = e?.activePayload?.[0]?.payload?.nome; if (n) set({ contratos: [n], posto: null }); }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tick={eixo} tickLine={false} axisLine={false} unit="%" />
                      <YAxis type="category" dataKey="nome" width={190} tick={{ ...eixo, fontSize: 10 }} tickLine={false} axisLine={false}
                        tickFormatter={(v: string) => (v.length > 30 ? v.slice(0, 29) + "…" : v)} />
                      <Tooltip formatter={(v: number) => `${v.toLocaleString("pt-BR")}%`} contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--muted))" }} />
                      <ReferenceLine x={95} stroke="hsl(var(--success))" strokeDasharray="4 4" />
                      <Bar dataKey="efetividade" name="Efetividade" radius={[0, 4, 4, 0]} className="cursor-pointer"
                        label={{ position: "right", fontSize: 10, formatter: (v: number) => `${v}%` }}>
                        {graficoContratos.map((g, i) => <Cell key={i} fill={COR_FAIXA[g.faixa]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <Vazio texto="Nenhum contrato com efetivo previsto no recorte." />}
            </Secao>
          </div>

          {/* ---- Tabela ---- */}
          <Secao titulo="Efetividade Detalhada" icone={Table2}
            sub={`${ordenadas.length.toLocaleString("pt-BR")} ${visao} · ${nomeMes(recorte.mes)} · clique no cabeçalho para ordenar`}
            acoes={<div className="flex rounded-md border p-0.5 text-xs">
              {(["contratos", "postos", "colaboradores"] as Visao[]).map((v) => (
                <button key={v} onClick={() => { setVisao(v); setPagina(1); }} className={cn("rounded px-2 py-1 font-semibold capitalize", visao === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{v}</button>
              ))}
            </div>}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    {th("titulo", visao === "contratos" ? "Contrato" : visao === "postos" ? "Posto" : "Colaborador", "text-left")}
                    {visao !== "colaboradores" && th("colaboradores", "Colab.")}
                    {th("previsto", "Previsto (dias)")}
                    {th("presentes", "Presentes")}
                    {th("faltas", "Faltas")}
                    {th("atestados", "Atest.")}
                    {th("afastamentos", "Afast.")}
                    {th("ferias", "Férias")}
                    {th("coberturas", "Cobert.")}
                    {th("descobertos", "Descob.")}
                    {th("efetividade", "Efetividade")}
                  </tr>
                </thead>
                <tbody>
                  {ordenadas.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA).map((l) => (
                    <tr key={l.chave} className={cn("border-t", visao === "contratos" && "cursor-pointer hover:bg-muted/40")}
                      onClick={visao === "contratos" ? () => { set({ contratos: [l.contrato], posto: null }); setVisao("postos"); setPagina(1); } : undefined}>
                      <td className="max-w-[320px] p-2">
                        <p className="truncate font-semibold" title={l.titulo}>{l.titulo}</p>
                        <p className="truncate text-[11px] text-muted-foreground" title={l.sub}>{l.sub}</p>
                      </td>
                      {visao !== "colaboradores" && <td className="p-2 text-center tabular-nums">{l.colaboradores}</td>}
                      <td className="p-2 text-center tabular-nums">{(l.r.previsto - l.r.aguardando).toLocaleString("pt-BR")}</td>
                      <td className="p-2 text-center tabular-nums text-success">{l.r.presentes.toLocaleString("pt-BR")}</td>
                      <td className="p-2 text-center font-semibold tabular-nums text-destructive">{l.r.faltas || ""}</td>
                      <td className="p-2 text-center tabular-nums">{l.r.atestados || ""}</td>
                      <td className="p-2 text-center tabular-nums">{l.r.afastamentos || ""}</td>
                      <td className="p-2 text-center tabular-nums">{l.r.ferias || ""}</td>
                      <td className="p-2 text-center tabular-nums">{l.coberturas || ""}</td>
                      <td className="p-2 text-center font-semibold tabular-nums text-destructive">{l.descobertos || ""}</td>
                      <td className="p-2 text-center"><CelulaPct v={l.r.efetividade} /></td>
                    </tr>
                  ))}
                  {!ordenadas.length && <tr><td colSpan={11}><Vazio texto="Nada no recorte com esses filtros." /></td></tr>}
                </tbody>
                {ordenadas.length > 0 && (
                  <tfoot className="border-t-2 bg-muted/50 font-bold">
                    <tr>
                      <td className="p-2">Total do recorte</td>
                      {visao !== "colaboradores" && <td className="p-2 text-center tabular-nums">{total.colaboradores}</td>}
                      <td className="p-2 text-center tabular-nums">{(total.previsto - total.aguardando).toLocaleString("pt-BR")}</td>
                      <td className="p-2 text-center tabular-nums">{total.presentes.toLocaleString("pt-BR")}</td>
                      <td className="p-2 text-center tabular-nums">{total.faltas}</td>
                      <td className="p-2 text-center tabular-nums">{total.atestados}</td>
                      <td className="p-2 text-center tabular-nums">{total.afastamentos}</td>
                      <td className="p-2 text-center tabular-nums">{total.ferias}</td>
                      <td className="p-2 text-center tabular-nums">{total.coberturas}</td>
                      <td className="p-2 text-center tabular-nums">{total.descobertos}</td>
                      <td className="p-2 text-center"><CelulaPct v={total.efetividade} /></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <Paginacao pagina={paginaAtual} total={ordenadas.length} porPagina={POR_PAGINA} onPagina={setPagina} />
          </Secao>
        </div>
      )}
    </div>
  );
}
