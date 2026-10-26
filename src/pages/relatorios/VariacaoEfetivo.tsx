import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronRight, Download, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  filtrarEmpresas, leituraDoMes, linhasCsv, registro, resumo, rotuloMes, somar, todosContratos,
  type ContratoEfetivo, type Registro, type VariacaoEfetivo,
} from "@/lib/diretoria/variacaoEfetivo";

// =====================================================================
// Relatórios › Turn-over › VARIAÇÃO DE EFETIVO e DETALHAMENTO DE EFETIVO
// (mig 20261025000010, 25/10/2026) — no formato do modelo
// variacao_efetivo_erp.html, com os números do próprio ERP:
//   previsto      = Planilha de Custo vigente no mês (regra do Ativos/Contratos)
//   trabalhando   = o "Tem" do Ativos/Contratos: só Situação "Trabalhando"
//                   (atestado, férias, auxílio-doença… não); o cartão soma só
//                   contratos com planilha, como lá (migs 20261026000010 e 040)
//   admissões/demissões do mês (regra do relatório de Colaboradores)
//   turnover      = demissões ÷ efetivo no fim do mês, afastados inclusive
//                   (taxa mensal do Turn-over)
// Contas em src/lib/diretoria/variacaoEfetivo.ts (com teste).
// =====================================================================

const fmt = (n: number) => n.toLocaleString("pt-BR");
const pct = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const AZUL = "#2457df", CINZA = "#bccbe1", VERMELHO = "#df3544", VERDE = "#129e61";

function Kpis({ itens }: { itens: [string, string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {itens.map(([t, v, d]) => (
        <Card key={t} className="p-4">
          <div className="text-xs text-muted-foreground">{t}</div>
          <div className="mt-1.5 text-2xl font-bold">{v}</div>
          <div className="text-[11px] text-muted-foreground">{d}</div>
        </Card>
      ))}
    </div>
  );
}

function Legenda({ children }: { children?: ReactNode }) {
  const itens: [string, string][] = [
    [CINZA, "Previsto: efetivo exigido na Planilha de Custo"], [AZUL, "Trabalhando: no fim do mês, sem afastados (o “Tem” do Ativos/Contratos)"],
    [VERMELHO, "Turnover e demissões"], [VERDE, "Admissões"],
  ];
  return (
    <div className="my-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {itens.map(([c, r]) => <span key={r} className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />{r}</span>)}
      {children}
    </div>
  );
}

function baixarCsv(v: VariacaoEfetivo) {
  const csv = "﻿" + linhasCsv(v).map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `variacao_efetivo_${v.ano}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Visão geral: todos os meses numa tabela ─────────────────────────────────
export function VariacaoEfetivoVisao({ v, onAbrirContrato }: { v: VariacaoEfetivo; onAbrirContrato: (chave: string) => void }) {
  const [fechadas, setFechadas] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const empresas = useMemo(() => filtrarEmpresas(v, busca), [v, busca]);
  const todos = useMemo(() => empresas.flatMap((e) => e.contratos), [empresas]);
  const r = useMemo(() => resumo(todos, v.meses), [todos, v.meses]);
  const colunas = Array.from({ length: 12 }, (_, i) => `${v.ano}-${String(i + 1).padStart(2, "0")}`);
  const alternar = (e: string) => setFechadas((s) => { const n = new Set(s); if (n.has(e)) n.delete(e); else n.add(e); return n; });

  const celulas = (pegar: (mes: string) => Registro) => colunas.map((mes) => {
    const x = pegar(mes);
    if (x.vazio) return <td key={mes} colSpan={5} className="border-l-2 border-l-slate-300 text-center text-muted-foreground/50">—</td>;
    return [
      <td key={mes + "p"} className="border-l-2 border-l-slate-300 font-semibold text-[#2254dd]">{fmt(x.previsto)}</td>,
      <td key={mes + "t"} className="font-semibold text-[#2254dd]">{fmt(x.trabalhando)}</td>,
      <td key={mes + "o"} className="font-semibold text-[#df3343]">{pct(x.turnover)}</td>,
      <td key={mes + "d"} className="font-semibold text-[#df3343]">{fmt(x.demissoes)}</td>,
      <td key={mes + "a"} className="font-semibold text-[#119554]">{fmt(x.admissoes)}</td>,
    ];
  });

  return (
    <div className="space-y-4">
      <Kpis itens={[
        ["Efetivo previsto", fmt(r.previsto), r.mes ? `Planilha de Custo em ${rotuloMes(r.mes)}` : "—"],
        ["Efetivo trabalhando", fmt(r.trabalhando), r.mes
          ? `Contratos com planilha em ${rotuloMes(r.mes)}, sem afastados${r.trabalhandoSemPlanilha > 0 ? ` · +${fmt(r.trabalhandoSemPlanilha)} sem planilha` : ""}`
          : "—"],
        ["Turnover médio", pct(r.turnoverMedio), "Média das taxas mensais"],
        ["Demissões", fmt(r.demissoes), `No ano (${v.meses.length} ${v.meses.length === 1 ? "mês" : "meses"})`],
        ["Admissões", fmt(r.admissoes), `No ano (${v.meses.length} ${v.meses.length === 1 ? "mês" : "meses"})`],
      ]} />
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Variação mensal de efetivo por empresa</h2>
            <p className="text-xs text-muted-foreground">Todos os meses na mesma tabela. Expanda a empresa para ver os contratos e clique num contrato para detalhar.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="h-9 w-64 pl-8" placeholder="Buscar empresa ou contrato…" value={busca} onChange={(x) => setBusca(x.target.value)} />
            </div>
            <Button variant="outline" className="text-primary" onClick={() => baixarCsv(v)}><Download className="mr-1.5 h-4 w-4" /> Exportar CSV (Excel)</Button>
          </div>
        </div>
        <Legenda />
        <div className="max-h-[62vh] overflow-auto rounded-md border">
          <table className="w-max min-w-full border-separate border-spacing-0 text-[11px] [&_td]:whitespace-nowrap [&_td]:border-b [&_td]:border-r [&_td]:border-slate-100 [&_td]:px-2 [&_td]:py-2 [&_td]:text-center">
            <thead className="[&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-r [&_th]:border-slate-200 [&_th]:px-2 [&_th]:py-2 [&_th]:text-center [&_th]:font-semibold">
              <tr className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-[#eaf1fa]">
                <th rowSpan={2} className="!left-0 !z-30 min-w-[260px] max-w-[260px] !text-left">Empresa / Contrato</th>
                {colunas.map((m) => <th key={m} colSpan={5} className="border-l-2 border-l-slate-300">{rotuloMes(m)}</th>)}
              </tr>
              <tr className="[&_th]:sticky [&_th]:top-[33px] [&_th]:z-20 [&_th]:bg-[#f4f7fc] [&_th]:text-[10px]">
                {colunas.map((m) => [
                  <th key={m + "p"} className="border-l-2 border-l-slate-300">Efetivo<br />previsto</th>, <th key={m + "t"}>Efetivo<br />trabalhando</th>,
                  <th key={m + "o"}>Turnover<br />(%)</th>, <th key={m + "d"}>Demissões</th>, <th key={m + "a"}>Admissões</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {empresas.map((e) => {
                const aberta = !fechadas.has(e.empresa);
                return [
                  <tr key={e.empresa} className="bg-[#f1f6fc] font-bold">
                    <td className="sticky left-0 z-10 bg-[#e7f0fc] !text-left">
                      <button className="inline-flex items-center gap-1 font-bold text-[#123f92]" onClick={() => alternar(e.empresa)}>
                        {aberta ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{e.empresa}
                        <span className="font-normal text-muted-foreground">({e.contratos.length})</span>
                      </button>
                    </td>
                    {celulas((mes) => somar(e.contratos, mes))}
                  </tr>,
                  ...(aberta ? e.contratos.map((c) => (
                    <tr key={c.chave} className="hover:bg-slate-50">
                      <td className="sticky left-0 z-10 max-w-[260px] bg-white !pl-7 !text-left">
                        <button className="inline-flex max-w-full items-center gap-1 truncate text-left font-semibold text-[#123f92] hover:underline" title={c.nome} onClick={() => onAbrirContrato(c.chave)}>
                          <span className="truncate">{c.nome}</span><ArrowUpRight className="h-3 w-3 shrink-0" />
                        </button>
                        {!c.no_erp && <div className="text-[9.5px] font-normal text-amber-700">filial da Senior sem contrato no ERP</div>}
                      </td>
                      {celulas((mes) => registro(c, mes))}
                    </tr>
                  )) : []),
                ];
              })}
              <tr className="bg-[#e3f1fb] font-extrabold">
                <td className="sticky left-0 z-10 bg-[#d9ecfa] !text-left">Total do Grupo</td>
                {celulas((mes) => somar(todos, mes))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Role para o lado para ver os 12 meses. Meses que ainda não começaram ficam com “—”. Turnover do mês = demissões ÷ efetivo no fim do mês, afastados inclusive (a mesma taxa do Resumo Turnover).
        </p>
      </Card>
    </div>
  );
}

// ── Detalhamento de um contrato ─────────────────────────────────────────────
export function VariacaoEfetivoDetalhe({ v, chave, onEscolher, onVoltar }: {
  v: VariacaoEfetivo; chave: string | null; onEscolher: (chave: string) => void; onVoltar: () => void;
}) {
  const empresaDe = (k: string | null) => v.empresas.find((e) => e.contratos.some((c) => c.chave === k)) ?? null;
  const empresa = empresaDe(chave) ?? v.empresas[0] ?? null;
  const contrato: ContratoEfetivo | null = empresa?.contratos.find((c) => c.chave === chave) ?? empresa?.contratos[0] ?? null;
  const [mesSel, setMesSel] = useState<string | null>(null);
  useEffect(() => { setMesSel(v.meses[v.meses.length - 1] ?? null); }, [contrato?.chave, v.meses]);

  if (!empresa || !contrato) return <Card className="p-6 text-sm text-muted-foreground">Nenhum contrato com efetivo neste ano.</Card>;
  const mes = mesSel ?? v.meses[v.meses.length - 1];
  const r = registro(contrato, mes);
  const ano = v.meses.map((m) => registro(contrato, m));
  const adm = ano.reduce((s, x) => s + x.admissoes, 0), dem = ano.reduce((s, x) => s + x.demissoes, 0);
  const leitura = leituraDoMes(r);
  const grafico = v.meses.map((m) => { const x = registro(contrato, m); return { mes: rotuloMes(m).slice(0, 3), Previsto: x.previsto, Trabalhando: x.trabalhando }; });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Button variant="outline" size="sm" className="text-primary" onClick={onVoltar}><ArrowLeft className="mr-1.5 h-4 w-4" /> Voltar à visão geral</Button>
            <h2 className="mt-3 text-base font-semibold">Detalhamento de efetivo por contrato</h2>
            <p className="text-xs text-muted-foreground">Histórico do efetivo, movimentações e turnover por mês.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Empresa</span>
            <Select value={empresa.empresa} onValueChange={(e) => { const x = v.empresas.find((y) => y.empresa === e); if (x?.contratos[0]) onEscolher(x.contratos[0].chave); }}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{v.empresas.map((e) => <SelectItem key={e.empresa} value={e.empresa}>{e.empresa}</SelectItem>)}</SelectContent>
            </Select>
            <span className="text-muted-foreground">Contrato</span>
            <Select value={contrato.chave} onValueChange={onEscolher}>
              <SelectTrigger className="h-9 w-80"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-80">{empresa.contratos.map((c) => <SelectItem key={c.chave} value={c.chave}>{c.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4">
          <Kpis itens={[
            ["Efetivo previsto", fmt(r.previsto), `Em ${rotuloMes(mes)}`], ["Efetivo trabalhando", fmt(r.trabalhando), `Em ${rotuloMes(mes)}`],
            ["Turnover", pct(r.turnover), "No mês selecionado"], ["Demissões", fmt(r.demissoes), "No mês selecionado"], ["Admissões", fmt(r.admissoes), "No mês selecionado"],
          ]} />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="p-4">
          <h2 className="text-base font-semibold">Evolução mensal do efetivo</h2>
          <p className="text-xs text-muted-foreground">Previsto na Planilha de Custo × efetivamente trabalhando</p>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grafico} barGap={3}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={40} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Previsto" fill={CINZA} radius={[3, 3, 0, 0]} />
                <Bar dataKey="Trabalhando" fill={AZUL} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-sm leading-relaxed text-slate-700">
            <b>{empresa.empresa} / {contrato.nome} — {rotuloMes(mes)}:</b>{" "}
            {leitura.tipo === "sem_previsto"
              ? <>sem posto na Planilha de Custo; <b>{r.trabalhando}</b> trabalhando.</>
              : <>o contrato previa <b>{r.previsto}</b> colaboradores e tinha <b>{r.trabalhando}</b> trabalhando.{" "}
                  {leitura.tipo === "deficit" ? <>Déficit de <b className="text-red-600">{leitura.diferenca}</b>.</>
                    : leitura.tipo === "excedente" ? <>Excedente de <b className="text-emerald-600">{leitura.diferenca}</b>.</>
                    : <>Efetivo exatamente no previsto.</>}</>}
            {" "}No ano: <b>{adm}</b> admissões e <b>{dem}</b> demissões.
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="text-base font-semibold">Histórico mensal do contrato</h2>
          <p className="mb-3 text-xs text-muted-foreground">Clique num mês para conferir os indicadores</p>
          <div className="max-h-[405px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#eef3fa]">
                <tr className="[&_th]:px-3 [&_th]:py-2.5 [&_th]:text-right [&_th:first-child]:text-left">
                  <th>Mês</th><th>Previsto</th><th>Trabalhando</th><th>Turnover</th><th>Demissões</th><th>Admissões</th>
                </tr>
              </thead>
              <tbody>
                {v.meses.map((m) => {
                  const x = registro(contrato, m);
                  return (
                    <tr key={m} onClick={() => setMesSel(m)}
                      className={cn("cursor-pointer border-b hover:bg-slate-50 [&_td]:px-3 [&_td]:py-2.5 [&_td]:text-right [&_td:first-child]:text-left", m === mes && "bg-blue-50")}>
                      <td>{rotuloMes(m)}</td><td>{fmt(x.previsto)}</td>
                      <td className="font-semibold text-[#2254dd]">{fmt(x.trabalhando)}</td>
                      <td className="font-semibold text-[#df3343]">{pct(x.turnover)}</td>
                      <td className="font-semibold text-[#df3343]">{fmt(x.demissoes)}</td>
                      <td className="font-semibold text-[#119554]">{fmt(x.admissoes)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-2 text-base font-semibold">Leitura gerencial</h2>
        <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-sm leading-relaxed text-slate-700">
          O <b>efetivo previsto</b> é o quadro da Planilha de Custo vigente no mês (o mesmo do RH › Ativos/Contratos). O <b>efetivo trabalhando</b> é
          quem estava de fato trabalhando no contrato no último dia do mês, com a mesma régua do “Tem” do RH › Ativos/Contratos: só a situação
          “Trabalhando” (atestado, férias, auxílio-doença e outros afastamentos não; nem Renda Técnica ou quem está fora da conta). No mês
          corrente é a foto de hoje, e o cartão soma só os contratos com Planilha de Custo, como lá. As admissões e demissões são movimentos ocorridos durante o mês e
          não devem ser confundidas com o quadro final: transferências de lotação, afastamentos e outras movimentações explicam diferenças entre
          entradas/saídas e a mudança no efetivo trabalhando. O turnover segue a regra do Turn-over: demissões do mês ÷ efetivo no fim do mês (afastados inclusive).
        </div>
      </Card>
    </div>
  );
}
