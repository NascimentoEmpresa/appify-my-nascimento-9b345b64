// =====================================================================
// 5. HISTÓRICO E INDICADORES (/app/operacional/efetividade/historico)
//
// O período (até 62 dias — limite da RPC, que traz batida por batida):
// evolução diária ou semanal da efetividade e das faltas, ausências por
// motivo, coberturas por status, rankings de contratos, colaboradores e
// diaristas, e o tempo médio de cada etapa da cobertura. Compara com o
// período anterior de mesmo tamanho.
// =====================================================================
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  BarChart3, Clock, Download, History, PieChart, RefreshCw, RotateCcw, Stethoscope, Trophy, UserCheck, UserMinus, UserX, Users,
} from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useQueryClient } from "@tanstack/react-query";
import { useEfetBase, useEfetDiaristas, useEfetOcorrencias } from "@/hooks/useEfetividade";
import {
  avaliarDia, chaveContrato, diasEntre, difDias, estadoCobertura, minutosEntre, fmtDuracao, pct, resumir, somaDias, baixarCsv,
  AUSENCIA_A_COBRIR, ROTULO_STATUS, ROTULO_TURNO, type DiaEfet, type Resumo, type StatusCobertura, type Turno,
} from "@/lib/efetividade";
import { BASE_ROTA, CabecalhoEfetividade, Carregando, CelulaPct, Erro, Kpi, Secao, Vazio, useFiltros, useSincronizadoAte } from "./shared";

const MAX_DIAS = 62;

export default function HistoricoIndicadores() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { filtros, set, sp } = useFiltros();
  const { data: sinc } = useSincronizadoAte();
  const [visao, setVisao] = useState<"dia" | "semana">("dia");

  const fimPadrao = sinc ?? null;
  const fim = sp.get("fim") ?? fimPadrao;
  const ini = sp.get("ini") ?? (fim ? `${fim.slice(0, 8)}01` : null);
  const tamanho = ini && fim ? difDias(fim, ini) + 1 : 0;
  const periodoValido = !!ini && !!fim && tamanho > 0 && tamanho <= MAX_DIAS;
  const prevFim = ini ? somaDias(ini, -1) : null;
  const prevIni = prevFim ? somaDias(prevFim, -(tamanho - 1)) : null;

  const contrato = filtros.contrato?.split("-").map(Number) ?? null;
  const base = useEfetBase(periodoValido ? ini : null, periodoValido ? fim : null, contrato?.[0] ?? null, contrato?.[1] ?? null);
  const anterior = useEfetBase(periodoValido ? prevIni : null, periodoValido ? prevFim : null, contrato?.[0] ?? null, contrato?.[1] ?? null);
  const ocs = useEfetOcorrencias(periodoValido ? ini : null, periodoValido ? fim : null);
  const { data: diaristas = [] } = useEfetDiaristas(periodoValido ? ini : null, periodoValido ? fim : null);
  const sincAte = base.data?.sincronizado_ate ?? sinc ?? null;

  // A matriz pessoa × dia, avaliada uma vez.
  const calc = useMemo(() => {
    if (!periodoValido) return null;
    const preps = base.preps.filter((p) => !filtros.turno || p.turno === filtros.turno);
    const ate = sincAte && sincAte < fim! ? sincAte : fim!;
    const dias = diasEntre(ini!, ate);
    const ocPor = new Map((ocs.data ?? []).filter((o) => o.empregado_id != null).map((o) => [`${o.data}|${o.empregado_id}`, o]));
    const porDia = new Map<string, DiaEfet[]>(dias.map((x) => [x, []]));
    const porContrato = new Map<string, { nome: string; dias: DiaEfet[]; coberturas: number; descobertos: number }>();
    const porPessoa: { nome: string; contrato: string; faltas: number; atestados: number; afastamentos: number }[] = [];
    for (const p of preps) {
      const k = chaveContrato(p.c.empresa, p.c.filial);
      if (!porContrato.has(k)) porContrato.set(k, { nome: p.c.contrato, dias: [], coberturas: 0, descobertos: 0 });
      const pc = porContrato.get(k)!;
      const pessoa = { nome: p.c.nome, contrato: p.c.contrato, faltas: 0, atestados: 0, afastamentos: 0 };
      for (const dia of dias) {
        const a = avaliarDia(p, dia, sincAte);
        if (a.situacao === "fora_contrato") continue;
        porDia.get(dia)!.push(a);
        pc.dias.push(a);
        if (a.situacao === "falta") pessoa.faltas++;
        else if (a.situacao === "atestado") pessoa.atestados++;
        else if (a.situacao === "afastamento") pessoa.afastamentos++;
        if (AUSENCIA_A_COBRIR.includes(a.situacao)) {
          const e = estadoCobertura(ocPor.get(`${dia}|${p.c.id}`));
          if (e === "coberto") pc.coberturas++;
          else if (e === "descoberto") pc.descobertos++;
        }
      }
      if (pessoa.faltas + pessoa.atestados + pessoa.afastamentos > 0) porPessoa.push(pessoa);
    }
    const serie = dias.map((x) => ({ data: x, ...resumir(porDia.get(x)!) }));
    const total = resumir([...porDia.values()].flat());
    return { dias, serie, total, porContrato, porPessoa };
  }, [base.preps, ocs.data, ini, fim, sincAte, filtros.turno, periodoValido]);

  const totalAnterior = useMemo(() => {
    if (!periodoValido || !anterior.data) return null;
    const preps = anterior.preps.filter((p) => !filtros.turno || p.turno === filtros.turno);
    return resumir(diasEntre(prevIni!, prevFim!).flatMap((x) => preps.map((p) => avaliarDia(p, x, anterior.data!.sincronizado_ate)).filter((a) => a.situacao !== "fora_contrato")));
  }, [anterior.preps, anterior.data, prevIni, prevFim, filtros.turno, periodoValido]);

  const nDias = calc?.dias.length || 1;
  const t = calc?.total;
  const coberturasPeriodo = (ocs.data ?? []).filter((o) => o.status === "ponto_confirmado" && (!contrato || (o.empresa === contrato[0] && o.filial === contrato[1])));
  const ocsFiltradas = (ocs.data ?? []).filter((o) => !contrato || (o.empresa === contrato[0] && o.filial === contrato[1]));

  const serieGrafico = useMemo(() => {
    if (!calc) return [];
    const ponto = (rotulo: string, r: Resumo) => {
      const base = r.previsto - r.aguardando;
      return { rotulo, efetividade: r.efetividade == null ? null : +(r.efetividade * 100).toFixed(1), faltas: base > 0 ? +((r.faltas / base) * 100).toFixed(1) : null, ausencias: base > 0 ? +(((r.faltas + r.atestados + r.afastamentos) / base) * 100).toFixed(1) : null };
    };
    if (visao === "dia") return calc.serie.map((s) => ponto(s.data.slice(8, 10) + "/" + s.data.slice(5, 7), s));
    const semanas = new Map<string, Resumo[]>();
    for (const s of calc.serie) {
      const dt = new Date(s.data + "T12:00:00Z");
      const seg = somaDias(s.data, -((dt.getUTCDay() + 6) % 7));
      if (!semanas.has(seg)) semanas.set(seg, []);
      semanas.get(seg)!.push(s);
    }
    return [...semanas.entries()].map(([seg, rs]) => {
      const soma = rs.reduce((a, r) => ({ ...a, previsto: a.previsto + r.previsto, presentes: a.presentes + r.presentes, faltas: a.faltas + r.faltas, atestados: a.atestados + r.atestados, afastamentos: a.afastamentos + r.afastamentos, aguardando: a.aguardando + r.aguardando }), { ...rs[0], previsto: 0, presentes: 0, faltas: 0, atestados: 0, afastamentos: 0, aguardando: 0 });
      soma.efetividade = soma.previsto - soma.aguardando > 0 ? soma.presentes / (soma.previsto - soma.aguardando) : null;
      return ponto(`sem. ${seg.slice(8, 10)}/${seg.slice(5, 7)}`, soma);
    });
  }, [calc, visao]);

  const rankContratos = useMemo(() => calc ? [...calc.porContrato.entries()].map(([k, v]) => ({ k, ...v, r: resumir(v.dias) }))
    .filter((x) => x.r.previsto > 0).sort((a, b) => (b.r.efetividade ?? 0) - (a.r.efetividade ?? 0)) : [], [calc]);
  const rankPessoas = useMemo(() => calc ? [...calc.porPessoa].sort((a, b) => (b.faltas + b.atestados) - (a.faltas + a.atestados) || b.faltas - a.faltas).slice(0, 10) : [], [calc]);
  const rankDiaristas = useMemo(() => [...diaristas].filter((x) => x.chamados > 0 || x.diarias > 0)
    .sort((a, b) => b.confirmados - a.confirmados || b.chamados - a.chamados).slice(0, 10), [diaristas]);

  const tempos = useMemo(() => {
    const media = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null && x >= 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    return [
      { r: "Tempo médio para acionar substituto", v: media(ocsFiltradas.map((o) => minutosEntre(o.created_at, o.acionado_em))), meta: 15 },
      { r: "Tempo médio para aceite", v: media(ocsFiltradas.map((o) => minutosEntre(o.acionado_em, o.aceito_em))), meta: 30 },
      { r: "Tempo médio até o substituto chegar", v: media(ocsFiltradas.map((o) => minutosEntre(o.acionado_em, o.chegada_em))), meta: 60 },
      { r: "Tempo médio até o ponto confirmado", v: media(ocsFiltradas.map((o) => minutosEntre(o.acionado_em, o.ponto_em))), meta: 90 },
    ];
  }, [ocsFiltradas]);

  const statusCount = useMemo(() => {
    const m = new Map<StatusCobertura, number>();
    for (const o of ocsFiltradas) m.set(o.status, (m.get(o.status) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [ocsFiltradas]);

  const motivos = t ? [
    { r: "Falta", v: t.faltas, cor: "bg-destructive" }, { r: "Atestado", v: t.atestados, cor: "bg-violet-500" },
    { r: "Afastamento", v: t.afastamentos, cor: "bg-orange-500" }, { r: "Férias", v: t.ferias, cor: "bg-info" },
  ] : [];
  const totalAus = motivos.reduce((a, m) => a + m.v, 0);

  const opcContratos = (base.data?.contratos ?? []).map((c) => ({ value: chaveContrato(c.empresa, c.filial), label: c.nome }));
  const exportar = () => calc && baixarCsv(`efetividade_${ini}_${fim}.csv`, [
    ["Data", "Previsto", "Presentes", "Faltas", "Atestados", "Afastamentos", "Férias", "Folgas", "Sem registro", "Efetividade"],
    ...calc.serie.map((s) => [s.data, s.previsto, s.presentes, s.faltas, s.atestados, s.afastamentos, s.ferias, s.folgas, s.semRegistro, pct(s.efetividade)]),
  ]);

  const carregando = base.isLoading || ocs.isLoading;
  const media = (v: number) => Math.round(v / nDias);

  return (
    <div>
      <CabecalhoEfetividade titulo="Histórico e Indicadores" icone={History}
        subtitulo="A evolução da efetividade, faltas, atestados, afastamentos e coberturas dos contratos."
        onAtualizar={() => qc.invalidateQueries({ queryKey: ["efetividade"] })} atualizando={base.isFetching}
        extra={<Button variant="outline" className="gap-1" onClick={exportar} disabled={!calc}><Download className="h-4 w-4" />Exportar</Button>} />

      <Card className="mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <label className="space-y-1 text-xs font-semibold">De<Input type="date" value={ini ?? ""} onChange={(e) => set({ ini: e.target.value || null })} /></label>
        <label className="space-y-1 text-xs font-semibold">Até<Input type="date" value={fim ?? ""} onChange={(e) => set({ fim: e.target.value || null })} /></label>
        <div className="space-y-1 text-xs font-semibold lg:col-span-2">Contrato
          <SearchableSelect value={filtros.contrato ?? ""} onChange={(v) => set({ c: v || null })} options={opcContratos} allowClear placeholder="Todos os contratos" searchPlaceholder="Buscar…" />
        </div>
        <div className="space-y-1 text-xs font-semibold">Turno
          <SearchableSelect value={filtros.turno ?? ""} onChange={(v) => set({ t: v || null })} allowClear placeholder="Todos"
            options={(Object.keys(ROTULO_TURNO) as Turno[]).map((x) => ({ value: x, label: ROTULO_TURNO[x] }))} />
        </div>
        <Button variant="outline" className="gap-2" onClick={() => set({ ini: null, fim: null, c: null, t: null })}><RotateCcw className="h-4 w-4" />Limpar</Button>
      </Card>
      {!periodoValido && ini && fim && <Card className="mb-4 p-3 text-sm text-warning">Escolha um período de 1 a {MAX_DIAS} dias.</Card>}
      <Erro erro={(base.error ?? ocs.error) as Error | null} />

      {carregando || !calc || !t ? <Carregando texto={`Lendo ${tamanho} dias de ponto…`} /> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
            <Kpi icon={Users} rotulo="Efetivo previsto (média/dia)" valor={media(t.previsto)} anterior={totalAnterior ? Math.round(totalAnterior.previsto / tamanho) : null} tom="info" dica="vs. período anterior" />
            <Kpi icon={UserCheck} rotulo="Presentes (média/dia)" valor={media(t.presentes)} anterior={totalAnterior ? Math.round(totalAnterior.presentes / tamanho) : null} tom="success" dica="vs. período anterior" />
            <Kpi icon={UserX} rotulo="Faltas" valor={t.faltas} anterior={totalAnterior?.faltas} tom="destructive" melhorSobe={false} dica="vs. período anterior" />
            <Kpi icon={Stethoscope} rotulo="Atestados (dias)" valor={t.atestados} anterior={totalAnterior?.atestados} tom="violet" melhorSobe={false} dica="vs. período anterior" />
            <Kpi icon={UserMinus} rotulo="Afastamentos (dias)" valor={t.afastamentos} anterior={totalAnterior?.afastamentos} tom="warning" melhorSobe={false} dica="vs. período anterior" />
            <Kpi icon={RefreshCw} rotulo="Coberturas realizadas" valor={coberturasPeriodo.length} tom="warning" dica={`${ocsFiltradas.length} ocorrência(s) registradas`} />
            <Kpi icon={BarChart3} rotulo="Efetividade operacional" valor={t.efetividade == null ? null : +(t.efetividade * 100).toFixed(1)} sufixo="%"
              anterior={totalAnterior?.efetividade == null ? null : +(totalAnterior.efetividade * 100).toFixed(1)} formatoDelta="pp" tom="success" dica="vs. período anterior" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Secao titulo="Evolução da Efetividade e Ausências" icone={BarChart3} sub="% do efetivo previsto"
              acoes={<div className="flex rounded-md border p-0.5 text-xs">
                {(["dia", "semana"] as const).map((v) => <button key={v} onClick={() => setVisao(v)} className={cn("rounded px-2 py-1 font-semibold", visao === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{v === "dia" ? "Dia" : "Semana"}</button>)}
              </div>}>
              <div className="h-72 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={serieGrafico} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} minTickGap={16} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} unit="%" />
                    <Tooltip formatter={(v: number) => `${v?.toLocaleString("pt-BR")}%`} contentStyle={{ fontSize: 12, borderRadius: 8, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="efetividade" name="Efetividade" stroke="hsl(var(--success))" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                    <Line type="monotone" dataKey="ausencias" name="Ausências (%)" stroke="hsl(var(--warning))" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    <Line type="monotone" dataKey="faltas" name="Faltas (%)" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Secao>

            <Secao titulo="Ausências por Motivo" icone={PieChart} sub={`${totalAus} dia(s)-pessoa no período`}>
              <div className="space-y-3 p-4">
                {motivos.map((m) => (
                  <div key={m.r}>
                    <div className="mb-1 flex justify-between text-sm"><span>{m.r}</span><b className="tabular-nums">{m.v} <span className="font-normal text-muted-foreground">({totalAus ? ((m.v / totalAus) * 100).toFixed(1) : 0}%)</span></b></div>
                    <div className="h-2.5 rounded-full bg-muted"><div className={cn("h-2.5 rounded-full", m.cor)} style={{ width: `${totalAus ? (m.v / totalAus) * 100 : 0}%` }} /></div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Folgas ({t.folgas}) e ativos sem registro de ponto ({Math.round(t.semRegistro / nDias)}/dia) não entram.</p>
              </div>
            </Secao>

            <Secao titulo="Coberturas por Status" icone={RefreshCw} sub={`${ocsFiltradas.length} ocorrência(s) registradas`}>
              <div className="space-y-3 p-4">
                {statusCount.map(([s, n]) => (
                  <div key={s}>
                    <div className="mb-1 flex justify-between text-sm"><span>{ROTULO_STATUS[s]}</span><b className="tabular-nums">{n} <span className="font-normal text-muted-foreground">({((n / ocsFiltradas.length) * 100).toFixed(1)}%)</span></b></div>
                    <div className="h-2.5 rounded-full bg-muted"><div className={cn("h-2.5 rounded-full", s === "ponto_confirmado" ? "bg-success" : s === "sem_cobertura" || s === "nao_realizada" ? "bg-destructive" : "bg-primary")} style={{ width: `${(n / ocsFiltradas.length) * 100}%` }} /></div>
                  </div>
                ))}
                {!statusCount.length && <Vazio texto="Nenhuma cobertura registrada no período." />}
              </div>
            </Secao>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Secao titulo="Ranking de Contratos por Efetividade" icone={Trophy}>
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted"><tr><th className="p-2">#</th><th className="p-2 text-left">Contrato</th><th className="p-2">Efetiv.</th><th className="p-2">Prev./dia</th><th className="p-2">Faltas</th><th className="p-2">Cobert.</th></tr></thead>
                  <tbody>
                    {rankContratos.map((x, i) => (
                      <tr key={x.k} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => nav(`${BASE_ROTA}/postos?c=${x.k}`)}>
                        <td className="p-2 text-center text-muted-foreground">{i + 1}</td>
                        <td className="max-w-[180px] truncate p-2 font-semibold">{x.nome}</td>
                        <td className="p-2 text-center"><CelulaPct v={x.r.efetividade} /></td>
                        <td className="p-2 text-center tabular-nums">{media(x.r.previsto)}</td>
                        <td className="p-2 text-center tabular-nums text-destructive">{x.r.faltas}</td>
                        <td className="p-2 text-center tabular-nums">{x.coberturas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Secao>
            <Secao titulo="Colaboradores com Mais Faltas" icone={UserX}>
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted"><tr><th className="p-2">#</th><th className="p-2 text-left">Colaborador</th><th className="p-2 text-left">Contrato</th><th className="p-2">Faltas</th><th className="p-2">Atest.</th><th className="p-2">Afast.</th></tr></thead>
                  <tbody>
                    {rankPessoas.map((x, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 text-center text-muted-foreground">{i + 1}</td>
                        <td className="max-w-[140px] truncate p-2 font-semibold">{x.nome}</td>
                        <td className="max-w-[120px] truncate p-2">{x.contrato}</td>
                        <td className="p-2 text-center font-bold tabular-nums text-destructive">{x.faltas}</td>
                        <td className="p-2 text-center tabular-nums">{x.atestados}</td>
                        <td className="p-2 text-center tabular-nums">{x.afastamentos}</td>
                      </tr>
                    ))}
                    {!rankPessoas.length && <tr><td colSpan={6}><Vazio texto="Sem ausências no período." /></td></tr>}
                  </tbody>
                </table>
              </div>
            </Secao>
            <Secao titulo="Ranking de Diaristas" icone={Users} sub="Acionamentos no período · diárias desde sempre">
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted"><tr><th className="p-2">#</th><th className="p-2 text-left">Diarista</th><th className="p-2">Chamados</th><th className="p-2">Aceitos</th><th className="p-2">Recusas</th><th className="p-2">Ponto conf.</th><th className="p-2">Taxa</th><th className="p-2">Diárias</th></tr></thead>
                  <tbody>
                    {rankDiaristas.map((x, i) => (
                      <tr key={x.id} className="border-t">
                        <td className="p-2 text-center text-muted-foreground">{i + 1}</td>
                        <td className="max-w-[130px] truncate p-2 font-semibold">{x.nome}</td>
                        <td className="p-2 text-center tabular-nums">{x.chamados}</td>
                        <td className="p-2 text-center tabular-nums">{x.aceitos}</td>
                        <td className="p-2 text-center tabular-nums">{x.recusas}</td>
                        <td className="p-2 text-center tabular-nums">{x.confirmados}</td>
                        <td className="p-2 text-center"><CelulaPct v={x.chamados ? x.confirmados / x.chamados : null} /></td>
                        <td className="p-2 text-center tabular-nums">{x.diarias}</td>
                      </tr>
                    ))}
                    {!rankDiaristas.length && <tr><td colSpan={8}><Vazio texto="Nenhuma diarista acionada ainda." /></td></tr>}
                  </tbody>
                </table>
              </div>
            </Secao>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Secao titulo="Contratos com Mais Postos Descobertos" icone={UserX} sub="Faltas e atestados sem cobertura, somados no período">
              <table className="w-full text-xs">
                <thead className="bg-muted"><tr><th className="p-2">#</th><th className="p-2 text-left">Contrato</th><th className="p-2">Descobertos</th><th className="p-2">Faltas</th><th className="p-2">Coberturas</th><th className="p-2">Efetividade</th></tr></thead>
                <tbody>
                  {[...rankContratos].sort((a, b) => b.descobertos - a.descobertos).filter((x) => x.descobertos > 0).slice(0, 8).map((x, i) => (
                    <tr key={x.k} className="border-t">
                      <td className="p-2 text-center text-muted-foreground">{i + 1}</td>
                      <td className="max-w-[220px] truncate p-2 font-semibold">{x.nome}</td>
                      <td className="p-2 text-center font-bold tabular-nums text-destructive">{x.descobertos}</td>
                      <td className="p-2 text-center tabular-nums">{x.r.faltas}</td>
                      <td className="p-2 text-center tabular-nums">{x.coberturas}</td>
                      <td className="p-2 text-center"><CelulaPct v={x.r.efetividade} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Secao>
            <Secao titulo="Tempo Médio de Cobertura" icone={Clock} sub="Das ocorrências registradas no período">
              <table className="w-full text-sm">
                <thead className="bg-muted text-xs"><tr><th className="p-2 text-left">Indicador</th><th className="p-2">Tempo</th></tr></thead>
                <tbody>
                  {tempos.map((x) => (
                    <tr key={x.r} className="border-t">
                      <td className="p-2">{x.r}</td>
                      <td className="p-2 text-center">
                        <span className={cn("rounded px-2 py-0.5 text-xs font-bold", x.v == null ? "text-muted-foreground" : x.v <= x.meta ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>{fmtDuracao(x.v)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Secao>
          </div>
        </div>
      )}
    </div>
  );
}
