// =====================================================================
// RELATÓRIOS › CUSTO DAS FALTAS POR CONTRATO (/app/relatorios/custo-faltas)
// 21/10/2026, mig 20261021000060.
//
// Quanto cada contrato perdeu com faltas: a soma do campo "Faltas" dos itens
// das notas fiscais (o desconto que o cliente aplicou por posto descoberto),
// por competência. As notas que contam são as do Relatório de Serviços — a
// regra e as somas estão em src/lib/relatorios/custoFaltas.ts.
//
// Uma RPC por período (dir_rel_custo_faltas); contrato, empresa, tipo de nota
// e situação filtram no cliente, sem voltar ao banco.
// =====================================================================
import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  ArrowLeft, Building2, ChevronDown, ChevronRight, FileSpreadsheet, FileText, Loader2, Percent, RotateCcw, ShieldAlert, TrendingDown, UserX,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { FiltroContratos } from "@/components/solicitacoes/FiltroContratos";
import { cn } from "@/lib/utils";
import { useCustoFaltas } from "@/hooks/useRelatoriosDiretoria";
import { TIPOS_NOTA } from "@/hooks/useNfEmissao";
import { fmtMoney, statusDaNota } from "@/pages/financeiro/nf-emissao/shared";
import {
  diasDeFalta, filtrarNotas, fimDoMes, montarPlanilhaCustoFaltas, notaConta, porContrato, porMes, rotuloComp, somaMeses, totalCustoFaltas,
  type FiltrosCustoFaltas, type LinhaContrato, type NotaFaltas,
} from "@/lib/relatorios/custoFaltas";

const mesAtual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const ATALHOS = [
  { k: 3, rotulo: "3 meses" }, { k: 6, rotulo: "6 meses" }, { k: 12, rotulo: "12 meses" }, { k: 0, rotulo: "Este ano" },
];
const pct = (v: number | null | undefined, casas = 2) =>
  v == null ? "—" : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
const moedaCurta = (v: number) => v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : fmtMoney(v);
const tooltipStyle = { fontSize: 12, borderRadius: 8, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" };
const eixo = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

type ColOrdem = "contrato" | "faltas" | "pctExecutado" | "executado" | "notasComFalta" | "mesesComFalta" | "diasFalta";

const FILTROS_INICIAIS = (): FiltrosCustoFaltas => {
  const ate = mesAtual();
  return { de: somaMeses(ate, -11), ate, contratos: [], empresa: null, tipoNota: null, status: null, soComFalta: true };
};

export default function CustoFaltasPainel() {
  const [f, setF] = useState<FiltrosCustoFaltas>(FILTROS_INICIAIS);
  const set = (p: Partial<FiltrosCustoFaltas>) => setF((x) => ({ ...x, ...p }));
  const [ordem, setOrdem] = useState<{ col: ColOrdem; asc: boolean }>({ col: "faltas", asc: false });
  const [aberto, setAberto] = useState<string | null>(null);

  const periodoValido = f.de <= f.ate;
  const q = useCustoFaltas(`${f.de}-01`, fimDoMes(periodoValido ? f.ate : f.de));
  const todas = useMemo(() => q.data?.notas ?? [], [q.data]);

  // As notas do período que contam (base das opções dos filtros e da contagem do FiltroContratos).
  const doPeriodo = useMemo(() => filtrarNotas(todas, { ...f, contratos: [], empresa: null, tipoNota: null, status: null }), [todas, f]);
  const notas = useMemo(() => filtrarNotas(todas, f), [todas, f]);
  const total = useMemo(() => totalCustoFaltas(notas), [notas]);
  const meses = useMemo(() => (periodoValido ? porMes(notas, f.de, f.ate) : []), [notas, f.de, f.ate, periodoValido]);
  const contratos = useMemo(() => porContrato(notas).filter((c) => !f.soComFalta || c.faltas !== 0), [notas, f.soComFalta]);
  const notasPorContrato = useMemo(() => {
    const m = new Map<string, NotaFaltas[]>();
    for (const n of notas) if (n.faltas) { if (!m.has(n.contrato_id)) m.set(n.contrato_id, []); m.get(n.contrato_id)!.push(n); }
    return m;
  }, [notas]);

  const opcEmpresas = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of doPeriodo) if (n.empresa_id) m.set(n.empresa_id, n.empresa_nome ?? n.empresa_id);
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [doPeriodo]);
  // Notas canceladas/substituídas/rascunho do período: avisadas, não somadas.
  const foraDaConta = useMemo(() => todas.filter((n) => !notaConta(n) && n.competencia >= f.de && n.competencia <= f.ate && n.faltas), [todas, f.de, f.ate]);

  const ordenados = useMemo(() => {
    const v = (c: LinhaContrato) => (ordem.col === "contrato" ? c.contrato : ordem.col === "pctExecutado" ? c.pctExecutado ?? -1 : c[ordem.col]);
    return [...contratos].sort((a, b) => {
      const x = v(a), y = v(b);
      const r = typeof x === "string" ? x.localeCompare(String(y), "pt-BR") : x - (y as number);
      return (ordem.asc ? r : -r) || a.contrato.localeCompare(b.contrato, "pt-BR");
    });
  }, [contratos, ordem]);

  const ranking = useMemo(() => [...contratos].filter((c) => c.faltas > 0).sort((a, b) => b.faltas - a.faltas).slice(0, 15)
    .map((c) => ({ nome: c.contrato, faltas: c.faltas })), [contratos]);
  const graficoMeses = meses.map((m) => ({ rotulo: rotuloComp(m.competencia), faltas: m.faltas, pct: m.pctExecutado == null ? null : +(m.pctExecutado * 100).toFixed(2) }));
  const maior = ranking[0];

  const filtrosTexto = useMemo(() => {
    const t: string[] = [];
    if (f.contratos.length) t.push(`Contratos: ${f.contratos.join(", ")}`);
    if (f.empresa) t.push(`Empresa: ${opcEmpresas.find((e) => e.value === f.empresa)?.label ?? f.empresa}`);
    if (f.tipoNota) t.push(`Tipo de nota: ${TIPOS_NOTA[f.tipoNota as keyof typeof TIPOS_NOTA] ?? f.tipoNota}`);
    if (f.status) t.push(`Situação: ${f.status === "pago" ? "Paga" : "Pendente"}`);
    return t;
  }, [f, opcEmpresas]);
  const temFiltro = filtrosTexto.length > 0;

  const exportar = () => {
    const wb = montarPlanilhaCustoFaltas({ de: f.de, ate: f.ate, filtrosTexto, notas, soComFalta: f.soComFalta });
    XLSX.writeFile(wb, `custo_faltas_${f.de}_a_${f.ate}${temFiltro ? "_filtrado" : ""}.xlsx`);
  };
  const atalho = (k: number) => {
    const ate = mesAtual();
    set({ ate, de: k ? somaMeses(ate, -(k - 1)) : `${ate.slice(0, 4)}-01` });
  };
  const atalhoAtivo = (k: number) => f.ate === mesAtual() && f.de === (k ? somaMeses(mesAtual(), -(k - 1)) : `${mesAtual().slice(0, 4)}-01`);

  const ordenar = (col: ColOrdem) => setOrdem((o) => ({ col, asc: o.col === col ? !o.asc : col === "contrato" }));
  const th = (col: ColOrdem, rotulo: string, className?: string) => (
    <th className={cn("cursor-pointer select-none whitespace-nowrap p-2 hover:text-foreground", className)} onClick={() => ordenar(col)}
      aria-sort={ordem.col === col ? (ordem.asc ? "ascending" : "descending") : undefined}>
      {rotulo}{ordem.col === col ? (ordem.asc ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Custo das Faltas por Contrato" module="Relatórios" breadcrumb={["Custo das Faltas por Contrato"]}
        subtitle="Quanto cada contrato teve descontado nas notas fiscais por faltas — o campo Faltas dos itens da NF, por competência."
        actions={<Button className="gap-2" onClick={exportar} disabled={!notas.length}><FileSpreadsheet className="h-4 w-4" />Exportar Excel</Button>} />
      <Link to="/app/relatorios" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> Relatório Geral
      </Link>

      {/* ---- Filtros ---- */}
      <Card className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {ATALHOS.map((a) => (
            <Button key={a.k} size="sm" variant={atalhoAtivo(a.k) ? "default" : "outline"} className="h-8 text-xs" onClick={() => atalho(a.k)}>{a.rotulo}</Button>
          ))}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            Competência de
            <Input type="month" className="h-8 w-36 text-xs" value={f.de} max={f.ate} onChange={(e) => e.target.value && set({ de: e.target.value })} />
            até
            <Input type="month" className="h-8 w-36 text-xs" value={f.ate} min={f.de} onChange={(e) => e.target.value && set({ ate: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FiltroContratos linhas={doPeriodo} campo="contrato_nome" selecionados={f.contratos} onChange={(contratos) => set({ contratos })} />
          <SearchableSelect value={f.empresa ?? ""} onChange={(v) => set({ empresa: v || null })} options={opcEmpresas} allowClear clearValue=""
            placeholder="Todas as empresas" searchPlaceholder="Buscar empresa…" triggerClassName="h-9 w-56 text-xs" />
          <SearchableSelect value={f.tipoNota ?? ""} onChange={(v) => set({ tipoNota: v || null })} allowClear clearValue="" placeholder="Todos os tipos de nota"
            options={Object.entries(TIPOS_NOTA).map(([value, label]) => ({ value, label: `${value} · ${label}` }))} triggerClassName="h-9 w-56 text-xs" />
          <div className="flex rounded-md border p-0.5 text-xs">
            {([null, "pago", "pendente"] as const).map((s) => (
              <button key={s ?? "todas"} onClick={() => set({ status: s })}
                className={cn("rounded px-2 py-1.5 font-semibold", f.status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {s == null ? "Pagas e pendentes" : s === "pago" ? "Só pagas" : "Só pendentes"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold">
            <Switch checked={f.soComFalta} onCheckedChange={(v) => set({ soComFalta: v })} /> Só contratos com falta
          </label>
          <Button variant="outline" size="sm" className="gap-2" disabled={!temFiltro}
            onClick={() => set({ contratos: [], empresa: null, tipoNota: null, status: null })}><RotateCcw className="h-4 w-4" />Limpar</Button>
        </div>
      </Card>

      {!periodoValido ? (
        <Card className="p-4 text-sm text-warning">A competência inicial está depois da final.</Card>
      ) : q.isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Somando as faltas das notas…</Card>
      ) : q.error ? (
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          {/function .*does not exist|Could not find the function/i.test((q.error as Error).message)
            ? "A migration 20261021000060_relatorios_custo_faltas.sql ainda não foi aplicada no banco."
            : (q.error as Error).message}
        </Card>
      ) : (
        <>
          {/* ---- KPIs ---- */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Kpi icone={TrendingDown} tom="destructive" rotulo="Descontado por faltas" valor={fmtMoney(total.faltas)} dica={`${rotuloComp(f.de)} a ${rotuloComp(f.ate)}`} />
            <Kpi icone={Percent} tom="warning" rotulo="Faltas sobre o executado" valor={pct(total.pctExecutado)} dica={`executado ${moedaCurta(total.executado)}`} />
            <Kpi icone={Building2} tom="primary" rotulo="Contratos com falta" valor={`${total.contratosComFalta}`} dica={`de ${total.contratos} com nota no período`} />
            <Kpi icone={FileText} tom="info" rotulo="Notas com falta" valor={`${total.notasComFalta}`} dica={`de ${total.notas} notas`} />
            <Kpi icone={UserX} tom="muted" rotulo="Média por contrato com falta" valor={total.contratosComFalta ? fmtMoney(total.faltas / total.contratosComFalta) : "—"}
              dica={total.diasFalta ? `${total.diasFalta.toLocaleString("pt-BR")} dia(s) informados no cálculo por dias` : "no período"} />
            <Kpi icone={TrendingDown} tom="destructive" rotulo="Maior custo" valor={maior ? fmtMoney(maior.faltas) : "—"} dica={maior?.nome ?? "nenhuma falta no período"} />
          </div>

          {foraDaConta.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {foraDaConta.length} nota(s) cancelada(s) ou substituída(s) com falta ({fmtMoney(foraDaConta.reduce((s, n) => s + n.faltas, 0))}) ficaram fora da soma — mesma regra do Relatório de Serviços.
            </p>
          )}

          {/* ---- Gráficos ---- */}
          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="p-4">
              <p className="text-sm font-semibold">Faltas por competência</p>
              <p className="mb-2 text-xs text-muted-foreground">R$ descontado nas notas (barras) e o peso sobre o executado (linha)</p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={graficoMeses} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="rotulo" tick={eixo} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="r" tick={eixo} tickLine={false} axisLine={false} tickFormatter={(v: number) => moedaCurta(v)} width={80} />
                    <YAxis yAxisId="p" orientation="right" tick={eixo} tickLine={false} axisLine={false} unit="%" width={44} />
                    <Tooltip contentStyle={tooltipStyle}
                      formatter={(v: number, nome: string) => (nome === "Faltas (R$)" ? fmtMoney(v) : v == null ? "—" : `${v.toLocaleString("pt-BR")}%`)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="r" dataKey="faltas" name="Faltas (R$)" fill="hsl(var(--destructive) / 0.75)" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="p" dataKey="pct" name="% do executado" stroke="hsl(var(--warning))" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-sm font-semibold">Contratos com maior custo de faltas</p>
              <p className="mb-2 text-xs text-muted-foreground">Os {ranking.length} maiores no período · clique para filtrar</p>
              {ranking.length ? (
                <div style={{ height: Math.max(220, ranking.length * 26 + 30) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ranking} layout="vertical" margin={{ top: 0, right: 70, left: 8, bottom: 0 }}
                      onClick={(e) => { const n = e?.activePayload?.[0]?.payload?.nome; if (n) set({ contratos: [n] }); }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" tick={eixo} tickLine={false} axisLine={false} tickFormatter={(v: number) => moedaCurta(v)} />
                      <YAxis type="category" dataKey="nome" width={200} tick={{ ...eixo, fontSize: 10 }} tickLine={false} axisLine={false}
                        tickFormatter={(v: string) => (v.length > 32 ? v.slice(0, 31) + "…" : v)} />
                      <Tooltip formatter={(v: number) => fmtMoney(v)} contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--muted))" }} />
                      <Bar dataKey="faltas" name="Faltas" fill="hsl(var(--destructive) / 0.75)" radius={[0, 4, 4, 0]} className="cursor-pointer"
                        label={{ position: "right", fontSize: 10, formatter: (v: number) => moedaCurta(v) }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="p-6 text-center text-sm text-muted-foreground">Nenhuma falta descontada nas notas do período.</p>}
            </Card>
          </div>

          {/* ---- Tabela por contrato ---- */}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <div>
                <p className="text-sm font-semibold">Por contrato</p>
                <p className="text-xs text-muted-foreground">{ordenados.length} contrato(s) · clique na linha para ver as notas e os itens com desconto</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="w-6 p-2" />
                    {th("contrato", "Contrato", "text-left")}
                    {th("faltas", "Faltas (R$)", "text-right")}
                    {th("pctExecutado", "% do executado", "text-right")}
                    {th("executado", "Executado (R$)", "text-right")}
                    {th("notasComFalta", "Notas c/ falta")}
                    {th("mesesComFalta", "Meses c/ falta")}
                    {th("diasFalta", "Dias")}
                  </tr>
                </thead>
                <tbody>
                  {ordenados.map((c) => {
                    const exp = aberto === c.contrato_id;
                    const ns = notasPorContrato.get(c.contrato_id) ?? [];
                    return (
                      <Fragment key={c.contrato_id}>
                        <tr className={cn("border-t", ns.length && "cursor-pointer hover:bg-muted/40")} onClick={() => ns.length && setAberto(exp ? null : c.contrato_id)}>
                          <td className="p-2 text-muted-foreground">{ns.length ? (exp ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}</td>
                          <td className="max-w-[360px] p-2">
                            <p className="truncate font-semibold" title={c.contrato}>{c.contrato}</p>
                            <p className="truncate text-[11px] text-muted-foreground">{[c.cliente, c.empresa].filter(Boolean).join(" · ")}</p>
                          </td>
                          <td className={cn("p-2 text-right font-bold tabular-nums", c.faltas ? "text-destructive" : "text-muted-foreground")}>{fmtMoney(c.faltas)}</td>
                          <td className="p-2 text-right tabular-nums">{pct(c.pctExecutado)}</td>
                          <td className="p-2 text-right tabular-nums">{fmtMoney(c.executado)}</td>
                          <td className="p-2 text-center tabular-nums">{c.notasComFalta} <span className="text-muted-foreground">/ {c.notas}</span></td>
                          <td className="p-2 text-center tabular-nums">{c.mesesComFalta || ""}</td>
                          <td className="p-2 text-center tabular-nums">{c.diasFalta ? c.diasFalta.toLocaleString("pt-BR") : ""}</td>
                        </tr>
                        {exp && (
                          <tr className="bg-muted/30">
                            <td />
                            <td colSpan={7} className="p-2">
                              <table className="w-full text-[11px]">
                                <thead className="text-muted-foreground">
                                  <tr><th className="p-1 text-left">Competência</th><th className="p-1 text-left">NF</th><th className="p-1 text-left">Tipo</th><th className="p-1 text-left">Situação</th>
                                    <th className="p-1 text-left">Itens com desconto</th><th className="p-1 text-right">Faltas</th><th className="p-1 text-right">Executado</th></tr>
                                </thead>
                                <tbody>
                                  {ns.map((n) => (
                                    <tr key={n.id} className="border-t border-border/60">
                                      <td className="p-1">{rotuloComp(n.competencia)}</td>
                                      <td className="p-1">{n.numero_nf ?? "—"}{n.variacao ? <span className="text-muted-foreground"> · {n.variacao}</span> : null}</td>
                                      <td className="p-1">{n.tipo_nota}</td>
                                      <td className="p-1">{statusDaNota(n) === "pago" ? "Paga" : "Pendente"}</td>
                                      <td className="p-1">
                                        {n.itens_falta.map((it) => `${it.identificacao}: ${fmtMoney(it.faltas)}`).join(" · ")}
                                        {diasDeFalta(n) ? <span className="text-muted-foreground"> ({diasDeFalta(n).toLocaleString("pt-BR")} dia(s))</span> : null}
                                      </td>
                                      <td className="p-1 text-right font-semibold tabular-nums text-destructive">{fmtMoney(n.faltas)}</td>
                                      <td className="p-1 text-right tabular-nums">{fmtMoney(n.valor_contrato_exec_total)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {!ordenados.length && <tr><td colSpan={8} className="p-6 text-center text-sm text-muted-foreground">Nenhum contrato com falta nas notas do período.</td></tr>}
                </tbody>
                {ordenados.length > 0 && (
                  <tfoot className="border-t-2 bg-muted/50 font-bold">
                    <tr>
                      <td />
                      <td className="p-2">Total</td>
                      <td className="p-2 text-right tabular-nums text-destructive">{fmtMoney(total.faltas)}</td>
                      <td className="p-2 text-right tabular-nums">{pct(total.pctExecutado)}</td>
                      <td className="p-2 text-right tabular-nums">{fmtMoney(total.executado)}</td>
                      <td className="p-2 text-center tabular-nums">{total.notasComFalta} / {total.notas}</td>
                      <td />
                      <td className="p-2 text-center tabular-nums">{total.diasFalta ? total.diasFalta.toLocaleString("pt-BR") : ""}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>
          <p className="text-[11px] text-muted-foreground">
            Fonte: campo <b>Faltas</b> dos itens da NF (Financeiro › Relatório de Serviços), pela competência da nota. Notas em rascunho ou enviadas ainda
            não entram; canceladas e substituídas não somam. "Executado" é o valor executado das mesmas notas.
          </p>
        </>
      )}
    </div>
  );
}

const TONS: Record<string, string> = {
  primary: "bg-primary/10 text-primary", destructive: "bg-destructive/10 text-destructive", warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info", muted: "bg-muted text-muted-foreground",
};

function Kpi({ icone: Icone, rotulo, valor, dica, tom }: { icone: typeof FileText; rotulo: string; valor: string; dica?: string; tom: string }) {
  return (
    <Card className="flex items-center gap-3 p-3">
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", TONS[tom])}><Icone className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-muted-foreground">{rotulo}</p>
        <p className="truncate text-xl font-bold tabular-nums">{valor}</p>
        {dica && <p className="truncate text-[11px] text-muted-foreground" title={dica}>{dica}</p>}
      </div>
    </Card>
  );
}
