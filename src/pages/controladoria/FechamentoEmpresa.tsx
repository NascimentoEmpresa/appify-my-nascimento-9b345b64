import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Info, Percent, Printer, ReceiptText, TrendingUp, CheckCircle2 } from "lucide-react";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { agruparFaturamento, custosPorContratoMes, custosVazios, ehContratoAdministrativo, RUBRICAS, totalCustos, type CustosPorRubrica, type RubricaCusto } from "./faturamento/regras";
import { SeletorBaseLeitura } from "./faturamento/SeletorBaseLeitura";
import { useLeituraCompartilhada } from "./faturamento/leituraCompartilhada";
import { CODIGO_PADRAO, codigosDoFiltro, FiltroCodigoNota } from "./faturamento/FiltroCodigoNota";
import { rotuloMes, useBaseFaturamento } from "./faturamento/useBaseFaturamento";
import { useCustosContratoAno, useDespesasAdmAno } from "./faturamento/useCustosContratoMes";
import { useLigacoesRubrica } from "./faturamento/useLigacoesRubrica";
import { DetalheDespesaDialog, type DetalheAberto } from "./fechamento/DetalheDespesaDialog";
import { TituloComFormula } from "./faturamento/Rentabilidade";
import {
  admPorClassificacao, detalheAdmPorClassificacao, detalheSocioPorClassificacao, admPorMesRubrica, despesasDosSocios, socioDoContrato, admSemClassificacao, ehContratoInvestimento, ordenarColunasSocios, ROTULO_INVESTIMENTOS, margemFinal, montarFechamento, ORIGEM_ADM, ORIGEM_RUBRICA, ROTULO_STATUS, statusDoFechamento, totalDoFechamento,
  type LinhaFechamento, type StatusFechamento,
} from "./fechamento/regras";

// SIS-2026-0642: Fechamento da Empresa (Controladoria) — lucro dos contratos menos as despesas administrativas,
// com o que já aconteceu no Fluxo de Caixa e a projeção dos meses seguintes. As regras estão em fechamento/regras.ts.

const TODOS = "todos";
const CORES = ["#1e3a8a", "#f97316", "#64748b", "#eab308", "#38bdf8", "#22c55e", "#a855f7", "#ec4899"];
const milhoes = (v: number) => `${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
const num2 = (n: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const pctTxt = (m: number | null) => (m === null ? "—" : `${(m * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const CAB = "h-auto px-2 py-1.5 text-right align-bottom whitespace-normal leading-tight";
const CEL = "px-2 py-1.5 align-middle text-right whitespace-nowrap";

const PILL_STATUS: Record<StatusFechamento, string> = {
  saudavel: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  atencao: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  critico: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
};

function StatusPill({ status }: { status: StatusFechamento | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return <span className={`inline-block min-w-[78px] rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ${PILL_STATUS[status]}`}>{ROTULO_STATUS[status]}</span>;
}

function FaixasStatus() {
  return (
    <ul className="space-y-0.5">
      <li><strong>Saudável</strong>: acima de 10%</li>
      <li><strong>Atenção</strong>: de 8% a 10%</li>
      <li><strong>Crítico</strong>: abaixo de 8%</li>
    </ul>
  );
}

// Valor que abre o detalhamento por classificação (SIS-2026-0730). Zero não tem o que detalhar.
function ValorDetalhavel({ valor, onClick }: { valor: number; onClick: () => void }) {
  if (!valor) return <>{num2(valor)}</>;
  return (
    <button type="button" onClick={onClick} title="Ver detalhamento por classificação" className="underline decoration-dotted underline-offset-2 hover:text-primary print:no-underline">
      {num2(valor)}
    </button>
  );
}

export default function FechamentoEmpresa() {
  // Filtro Código (tipo da nota): padrão N, como sempre foi.
  // SIS-2026-0721: base, código e empresa vêm da leitura compartilhada com o Faturamento e a Lucratividade.
  const { base, setBase, codigo, setCodigo, empresaId, setEmpresaId } = useLeituraCompartilhada();
  const codigos = useMemo(() => codigosDoFiltro(codigo), [codigo]);
  const { contratos, nfs, empresas, contratoPorId, executavelDoContrato, carregando } = useBaseFaturamento(codigos);

  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = `${anoAtual}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const [ano, setAno] = useState(anoAtual);
  const [contratoId, setContratoId] = useState(TODOS);
  const [periodo, setPeriodo] = useState(TODOS);
  const [aba, setAba] = useState("mensal");
  const [buscaMes, setBuscaMes] = useState("");

  const { data: custosAno = [], isLoading: carregandoCustos, error: erroCustos } = useCustosContratoAno(ano, true, base);
  const { data: admAno = [], isLoading: carregandoAdm, error: erroAdm } = useDespesasAdmAno(ano, base);
  const { data: ligacoes } = useLigacoesRubrica();

  // Mês real de hoje, mesmo vendo outro ano: ano passado fica todo realizado, ano seguinte todo projetado.
  const meses = useMemo(() => Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`), [ano]);
  const anos = useMemo(() => {
    const s = new Set<number>([anoAtual, anoAtual + 1]);
    for (const n of nfs) s.add(Number(n.competencia.slice(0, 4)));
    return [...s].sort((a, b) => b - a);
  }, [nfs, anoAtual]);

  // Executável de cada contrato em cada mês do ano (calculado uma vez; todas as empresas usam).
  const execGrade = useMemo(() => {
    const g = new Map<string, Map<string, number>>();
    for (const c of contratos) {
      const m = new Map<string, number>();
      for (const mes of meses) m.set(mes, executavelDoContrato(c, mes));
      g.set(c.id, m);
    }
    return g;
  }, [contratos, meses, executavelDoContrato]);

  const nfsDoAno = useMemo(() => nfs.filter((n) => n.competencia.startsWith(`${ano}-`)), [nfs, ano]);
  const custosContratoPorMesContrato = useMemo(() => custosPorContratoMes(custosAno, ligacoes), [custosAno, ligacoes]);
  // SIS-2026-0709: contrato "ADMINISTRATIVO <SÓCIO>" → nome do sócio. Fica fora do lucro dos contratos e entra no Resultado com Sócios.
  const socioPorContrato = useMemo(() => {
    const m = new Map<string, string>();
    // SIS-2026-0744: contrato "INVESTIMENTOS …" entra como mais uma coluna desta aba (rótulo "Investimentos"), com a mesma regra dos sócios.
    for (const c of contratos) { const s = socioDoContrato(c.nome) ?? (ehContratoInvestimento(c.nome) ? ROTULO_INVESTIMENTOS : null); if (s) m.set(c.id, s); }
    return m;
  }, [contratos]);
  // Contratos "ADMINISTRATIVO - …" (inclusive os dos sócios) são centros de custo da empresa, não contrato de cliente: o Lucro dos Contratos
  // não os conta (igual à Lucratividade de Contratos). O que foi gasto neles é despesa administrativa, exceto o dos sócios (aba própria).
  const idsAdministrativos = useMemo(() => new Set(contratos.filter((c) => ehContratoAdministrativo(c.nome)).map((c) => c.id)), [contratos]);
  // (as linhas voltam "sem contrato": é como as funções de despesa administrativa as reconhecem)
  const admDeContratos = useMemo(
    () => custosAno
      .filter((l) => !!l.contrato_id && idsAdministrativos.has(l.contrato_id) && !socioPorContrato.has(l.contrato_id))
      .map((l) => ({ ...l, contrato_id: null })),
    [custosAno, idsAdministrativos, socioPorContrato],
  );
  // Tudo o que é despesa administrativa no Fluxo: sem contrato + contratos administrativos.
  const admTodas = useMemo(() => [...admAno, ...admDeContratos], [admAno, admDeContratos]);

  // Monta as 12 linhas do ano para uma empresa (ou todas) e um contrato (ou todos). Com contrato escolhido só entra o
  // lucro dele: despesa administrativa não pertence a contrato.
  function linhasDoRecorte(empId: string, ctId: string): LinhaFechamento[] {
    const passa = (id: string) => {
      const c = contratoPorId.get(id);
      if (!c) return false;
      if (empId !== TODOS && c.empresa_id !== empId) return false;
      if (ctId !== TODOS && c.id !== ctId) return false;
      return true;
    };
    const liquidoPorMes = new Map<string, number>();
    for (const [mes, t] of agruparFaturamento(nfsDoAno.filter((n) => passa(n.contrato_id)), (n) => n.competencia.slice(0, 7))) liquidoPorMes.set(mes, t.liquido);
    const executavelPorMes = new Map<string, number>();
    for (const c of contratos) {
      if (!passa(c.id)) continue;
      for (const [mes, v] of execGrade.get(c.id) ?? []) executavelPorMes.set(mes, (executavelPorMes.get(mes) ?? 0) + v);
    }
    const custosContratoPorMes = new Map<string, number>();
    for (const [chave, c] of custosContratoPorMesContrato) {
      const [id, mes] = chave.split("|");
      if (passa(id) && !socioPorContrato.has(id) && (ctId !== TODOS || !idsAdministrativos.has(id))) custosContratoPorMes.set(mes, (custosContratoPorMes.get(mes) ?? 0) + totalCustos(c));
    }
    // Com contrato escolhido só entra o lucro dele: despesa de sócio, como a administrativa, não pertence a contrato.
    const sociosPorMes = ctId !== TODOS ? new Map<string, Map<string, number>>() : despesasDosSocios(custosAno.filter((l) => !!l.contrato_id && passa(l.contrato_id)), socioPorContrato, ligacoes);
    const admPorMes = ctId !== TODOS ? new Map<string, CustosPorRubrica>() : admPorMesRubrica(admTodas, ligacoes, empId === TODOS ? null : empId);
    return montarFechamento({ meses, mesAtual, liquidoPorMes, executavelPorMes, custosContratoPorMes, admPorMes, sociosPorMes });
  }

  const linhasAno = useMemo(
    () => linhasDoRecorte(empresaId, contratoId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [empresaId, contratoId, nfsDoAno, contratos, execGrade, custosContratoPorMesContrato, admTodas, custosAno, socioPorContrato, idsAdministrativos, ligacoes, meses, mesAtual]
  );

  const visivel = (l: LinhaFechamento) => periodo === TODOS || (periodo === "realizado" && !l.projetado) || (periodo === "projetado" && l.projetado) || periodo === l.mes;
  const linhas = useMemo(() => linhasAno.filter(visivel), [linhasAno, periodo]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => totalDoFechamento(linhas), [linhas]);
  const temProjetado = linhas.some((l) => l.projetado);
  // Colunas da aba com sócios: quem tem despesa em algum mês do ano (ordem alfabética), mesmo que no período filtrado seja zero.
  // Todo sócio cadastrado aparece como coluna (mesmo sem despesa no ano), respeitando o filtro de empresa.
  const nomesSocios = useMemo(() => {
    const s = new Set<string>(linhasAno.flatMap((l) => Object.keys(l.socios)));
    for (const c of contratos) {
      const nome = socioPorContrato.get(c.id);
      if (nome && (empresaId === TODOS || c.empresa_id === empresaId)) s.add(nome);
    }
    return ordenarColunasSocios([...s]);
  }, [linhasAno, contratos, socioPorContrato, empresaId]);

  // SIS-2026-0730: clique no valor abre o detalhamento por classificação (mesma seleção de linhas e mesmo mês da célula).
  const [detalhe, setDetalhe] = useState<DetalheAberto | null>(null);
  const empresaAdm = empresaId === TODOS ? null : empresaId;
  const linhasDosSocios = useMemo(
    () => custosAno.filter((l) => !!l.contrato_id && (empresaId === TODOS || contratoPorId.get(l.contrato_id)?.empresa_id === empresaId)),
    [custosAno, empresaId, contratoPorId],
  );
  const textoPeriodo = (meses: string[]) => {
    if (meses.length === 1) return `no mês de ${new Date(`${meses[0]}-01T00:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`;
    return `no período selecionado (${rotuloMes(meses[0])} a ${rotuloMes(meses[meses.length - 1])})`;
  };
  const rotuloPeriodo = (meses: string[]) => (meses.length === 1 ? rotuloMes(meses[0]) : "Total do período");
  const abrirAdm = (rotulo: string, rubricas: RubricaCusto[] | null, mesesAlvo: string[], valorCelula: number) => {
    const alvo = new Set(mesesAlvo);
    setDetalhe({
      titulo: `${rotulo} | ${rotuloPeriodo(mesesAlvo)}`,
      subtitulo: `Composição da despesa administrativa atribuída a ${rotulo} ${textoPeriodo(mesesAlvo)}.`,
      itens: detalheAdmPorClassificacao(admTodas, alvo, rubricas, ligacoes, empresaAdm),
      valorCelula,
      projetado: mesesAlvo.some((m) => m > mesAtual),
    });
  };
  const abrirSocio = (socio: string, mesesAlvo: string[], valorCelula: number) => {
    setDetalhe({
      titulo: `${socio} | ${rotuloPeriodo(mesesAlvo)}`,
      subtitulo: `Composição da despesa administrativa atribuída a ${socio} ${textoPeriodo(mesesAlvo)}.`,
      itens: detalheSocioPorClassificacao(linhasDosSocios, new Set(mesesAlvo), socio, socioPorContrato, ligacoes),
      valorCelula,
      projetado: mesesAlvo.some((m) => m > mesAtual),
    });
  };
  const mesesDaTabela = linhas.map((l) => l.mes);

  const termo = buscaMes.trim().toLowerCase();
  const linhasTabela = linhas.filter((l) => !termo || rotuloMes(l.mes).toLowerCase().includes(termo) || l.mes.includes(termo));

  const serie = linhas.map((l) => ({
    mes: rotuloMes(l.mes), lucro: l.lucroContratos, adm: l.totalAdm, resultado: l.resultado,
    realizado: l.projetado ? null : l.resultado, projetado: l.projetado ? l.resultado : null,
  }));
  // Liga a linha tracejada projetada ao último mês realizado.
  let ultimoRealizado = -1;
  serie.forEach((s, i) => { if (s.realizado !== null) ultimoRealizado = i; });
  if (ultimoRealizado >= 0 && serie[ultimoRealizado + 1]?.projetado != null) serie[ultimoRealizado].projetado = serie[ultimoRealizado].realizado;

  const donut = RUBRICAS.map((r, i) => ({ nome: r.label, valor: total.adm[r.id], cor: CORES[i % CORES.length] })).filter((d) => d.valor > 0);
  const totalDonut = donut.reduce((s, d) => s + d.valor, 0);

  const mesesVisiveis = useMemo(() => new Set(linhas.map((l) => l.mes)), [linhas]);
  const porClassificacao = useMemo(
    () => (contratoId !== TODOS ? [] : admPorClassificacao(admTodas, mesesVisiveis, ligacoes, empresaId === TODOS ? null : empresaId)),
    [admTodas, mesesVisiveis, ligacoes, empresaId, contratoId]
  );
  const semClass = useMemo(() => admSemClassificacao(admAno, empresaId === TODOS ? null : empresaId), [admAno, empresaId]);

  const porEmpresa = useMemo(
    () =>
      empresas
        .map((e) => {
          const ls = linhasDoRecorte(e.id, contratoId).filter(visivel);
          const t = totalDoFechamento(ls);
          return { id: e.id, nome: e.nome, ...t };
        })
        .filter((x) => x.lucroContratos !== 0 || x.totalAdm !== 0)
        .sort((a, b) => b.lucroContratos - a.lucroContratos),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [empresas, contratoId, periodo, nfsDoAno, contratos, execGrade, custosContratoPorMesContrato, admTodas, idsAdministrativos, ligacoes, meses, mesAtual]
  );

  const carregandoDados = carregando || carregandoCustos || carregandoAdm;
  const erro = erroCustos || erroAdm;

  return (
    <div className="space-y-6">
      <PageHeader
        module="Controladoria"
        breadcrumb={["Fechamento da Empresa"]}
        title="Fechamento da Empresa"
        subtitle="Acompanhe o fechamento consolidado da empresa com base no lucro dos contratos menos as despesas administrativas."
        actions={<Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Imprimir</Button>}
      />

      <div className="card-elevated p-3 flex items-center gap-2 flex-wrap text-xs print:hidden">
        <Select value={String(ano)} onValueChange={(v) => { setAno(Number(v)); setPeriodo(TODOS); }}>
          <SelectTrigger className="h-8 w-[90px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{anos.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <SeletorBaseLeitura base={base} onChange={setBase} />
        <FiltroCodigoNota valor={codigo} onChange={setCodigo} />
        <Select value={empresaId} onValueChange={(v) => { setEmpresaId(v); setContratoId(TODOS); }}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Empresa" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas as empresas</SelectItem>
            {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={periodo} onValueChange={setPeriodo}>
          <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue placeholder="Período" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os períodos</SelectItem>
            <SelectItem value="realizado">Só realizado</SelectItem>
            <SelectItem value="projetado">Só projetado</SelectItem>
            {meses.map((m) => <SelectItem key={m} value={m}>{rotuloMes(m)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={contratoId} onValueChange={setContratoId}>
          <SelectTrigger className="h-8 w-[240px] text-xs"><SelectValue placeholder="Contrato" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os contratos</SelectItem>
            {contratos.filter((c) => empresaId === TODOS || c.empresa_id === empresaId).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setEmpresaId(TODOS); setContratoId(TODOS); setPeriodo(TODOS); setBuscaMes(""); setCodigo(CODIGO_PADRAO); }}>Limpar</Button>
      </div>

      {erro && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">Não foi possível carregar o Fluxo de Caixa: {(erro as Error).message}</p>}
      {contratoId !== TODOS && (
        <p className="flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
          <Info className="h-3.5 w-3.5 shrink-0" /> Com um contrato escolhido, aparece só o lucro dele: despesa administrativa não pertence a contrato.
        </p>
      )}
      {semClass.linhas > 0 && (
        <p className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <Info className="h-3.5 w-3.5 shrink-0" /> {semClass.linhas.toLocaleString("pt-BR")} saída(s) sem contrato e sem classificação ({fmtMoney(semClass.valor)}) ficaram fora das despesas administrativas em {ano}.
        </p>
      )}

      {carregandoDados ? (
        <p className="text-sm text-muted-foreground py-10 text-center">Carregando...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiTile label="Lucro dos Contratos" valor={fmtMoney(total.lucroContratos)} sub={temProjetado ? `${fmtMoney(total.lucroRealizado)} realizado + ${fmtMoney(total.lucroProjetado)} projetado` : "Valor consolidado do período"} icon={<TrendingUp />} cor="sky"
              info={<>
                <p><strong>Valor líquido faturado − custos dos contratos</strong>, somado nos meses do período.</p>
                <p>Faturamento: NFs Código N validadas do Relatório de Serviços (fora de canceladas e substituídas), pela competência da nota. Custos: saídas do Fluxo de Caixa com contrato, {base === "pagamento" ? "pela data de pagamento" : "pela competência"}. Os contratos "ADMINISTRATIVO - …" não entram aqui (são despesa administrativa). É o mesmo Lucro Bruto da Lucratividade de Contratos.</p>
                <p>Meses futuros são projetados (notas já emitidas ou executável do contrato × proporção líquido/executável recente, menos o custo lançado ou a média dos últimos 3 meses, o maior).</p>
              </>}
            />
            <KpiTile label="Despesas Administrativas" valor={fmtMoney(total.totalAdm)} sub="Valor consolidado do período" icon={<ReceiptText />} cor="slate"
              info={<>
                <p><strong>Soma das colunas de rubrica</strong> (Salários, Férias, Rescisões, FGTS, INSS, VA, VT e Outras) nos meses do período.</p>
                <p>{ORIGEM_ADM}</p>
                <p>Meses futuros: o lançado/programado ou a média dos últimos 3 meses, o maior por rubrica.</p>
              </>}
            />
            <KpiTile
              label="Resultado Final"
              valor={fmtMoney(total.resultado)}
              sub="Lucro dos contratos menos despesas"
              icon={<CheckCircle2 />}
              info={<p><strong>Lucro dos Contratos − Despesas Administrativas</strong> do período: o que sobra da operação dos contratos depois de pagar a estrutura administrativa.</p>}
              cor={total.resultado < 0 ? "red" : "emerald"}
              valorClass={total.resultado < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}
            />
            <KpiTile label="Margem Final" valor={pctTxt(total.margem)} sub="Resultado final ÷ lucro dos contratos" icon={<Percent />} cor="sky" valorClass="text-sky-700 dark:text-sky-300"
              info={<>
                <p><strong>Resultado Final ÷ Lucro dos Contratos</strong>. Em branco quando não há lucro de contratos no período.</p>
                <p>Status do mês: acima de 10% Saudável, de 8% a 10% Atenção, abaixo de 8% Crítico.</p>
              </>}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Fechamento Mensal (R$)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={serie}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="mes" fontSize={11} />
                    <YAxis fontSize={11} tickFormatter={milhoes} />
                    <Tooltip formatter={(v: number) => fmtMoney(v)} />
                    <Legend />
                    <Bar dataKey="lucro" name="Lucro dos Contratos" fill="#1e3a8a" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="adm" name="Desp. Administrativas" fill="#f97316" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="resultado" name="Resultado Final" fill="#22c55e" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Evolução do Resultado (R$)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={230}>
                  <LineChart data={serie}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="mes" fontSize={11} />
                    <YAxis fontSize={11} tickFormatter={milhoes} />
                    <Tooltip formatter={(v: number) => fmtMoney(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="realizado" name="Resultado Final" stroke="#16a34a" strokeWidth={2} dot connectNulls={false} />
                    <Line type="monotone" dataKey="projetado" name="Projetado" stroke="#16a34a" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Composição das Despesas Administrativas</CardTitle></CardHeader>
              <CardContent>
                {donut.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-10 text-center">Sem despesas administrativas no período.</p>
                ) : (
                  <div className="flex items-center gap-2">
                    <ResponsiveContainer width="50%" height={200}>
                      <PieChart>
                        <Pie data={donut} dataKey="valor" nameKey="nome" innerRadius={42} outerRadius={78} paddingAngle={2}>
                          {donut.map((d) => <Cell key={d.nome} fill={d.cor} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => fmtMoney(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <ul className="flex-1 space-y-1 text-xs">
                      {donut.map((d) => (
                        <li key={d.nome} className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ background: d.cor }} />
                          <span className="flex-1">{d.nome}</span>
                          <span className="text-muted-foreground">{totalDonut > 0 ? `${((d.valor / totalDonut) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : "—"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Tabs value={aba} onValueChange={setAba}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <TabsList>
                <TabsTrigger value="mensal">Resumo Mensal</TabsTrigger>
                <TabsTrigger value="socios">Resumo Mensal com Sócios</TabsTrigger>
                <TabsTrigger value="adm">Despesas Administrativas</TabsTrigger>
                <TabsTrigger value="empresa">Por Empresa</TabsTrigger>
              </TabsList>
              {(aba === "mensal" || aba === "socios") && (
                <input
                  value={buscaMes}
                  onChange={(e) => setBuscaMes(e.target.value)}
                  placeholder="Buscar mês…"
                  className="h-8 w-44 rounded-md border border-border bg-background px-3 text-xs outline-none focus:border-primary print:hidden"
                />
              )}
            </div>

            <TabsContent value="mensal">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-auto px-2 py-1.5 align-bottom">Mês</TableHead>
                        <TableHead className={CAB}><TituloComFormula titulo="Lucro dos Contratos (R$)" formula="Valor líquido faturado − custos dos contratos no mês (mesma conta da Lucratividade de Contratos). Nos meses projetados: notas já emitidas ou executável × proporção líquido/executável dos últimos meses, menos o custo lançado ou a média dos últimos meses (o maior)." /></TableHead>
                        {RUBRICAS.map((r) => <TableHead key={r.id} className={CAB}><TituloComFormula titulo={`${r.label} (R$)`} formula={<><p>{ORIGEM_RUBRICA[r.id]}</p><p>{ORIGEM_ADM}</p></>} /></TableHead>)}
                        <TableHead className={CAB}><TituloComFormula titulo="Total Desp. Adm (R$)" formula="Soma das rubricas: saídas do Fluxo de Caixa sem contrato (transferência, aplicação, empréstimo e financiamento ficam de fora). Nos meses projetados, o lançado/programado ou a média dos últimos meses, o maior por rubrica." /></TableHead>
                        <TableHead className={CAB}><TituloComFormula titulo="Resultado Final (R$)" formula="Lucro dos Contratos − Total Desp. Adm. Sem as despesas dos sócios: elas entram na aba Resumo Mensal com Sócios, depois deste resultado." /></TableHead>
                        <TableHead className={CAB}><TituloComFormula titulo="Margem Final (%)" formula="Resultado Final ÷ Lucro dos Contratos. Em branco quando não há lucro de contratos no mês." /></TableHead>
                        <TableHead className={`${CAB} text-center`}><TituloComFormula alinhar="center" titulo="Status" formula={<><p>Pela Margem Final:</p><FaixasStatus /></>} /></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linhasTabela.length === 0 && (
                        <TableRow><TableCell colSpan={RUBRICAS.length + 6} className="text-center text-muted-foreground py-8">Nenhum mês encontrado.</TableCell></TableRow>
                      )}
                      {linhasTabela.map((l) => (
                        <TableRow key={l.mes}>
                          <TableCell className="px-2 py-1.5 whitespace-nowrap font-medium">
                            {rotuloMes(l.mes)}
                            {l.projetado && <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[9px] font-medium text-sky-700 border-sky-300">Projetado</Badge>}
                          </TableCell>
                          <TableCell className={CEL}>{num2(l.lucroContratos)}</TableCell>
                          {RUBRICAS.map((r) => <TableCell key={r.id} className={CEL}><ValorDetalhavel valor={l.adm[r.id]} onClick={() => abrirAdm(r.label, [r.id], [l.mes], l.adm[r.id])} /></TableCell>)}
                          <TableCell className={CEL}><ValorDetalhavel valor={l.totalAdm} onClick={() => abrirAdm("Total Desp. Adm", null, [l.mes], l.totalAdm)} /></TableCell>
                          <TableCell className={`${CEL} font-semibold ${l.resultado < 0 ? "text-red-600" : ""}`}>{num2(l.resultado)}</TableCell>
                          <TableCell className={CEL}>{pctTxt(l.margem)}</TableCell>
                          <TableCell className="px-2 py-1.5 text-center"><StatusPill status={l.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    {linhasTabela.length > 0 && !termo && (
                      <TableFooter>
                        <TableRow>
                          <TableCell className="px-2 py-1.5 font-semibold">Total</TableCell>
                          <TableCell className={`${CEL} font-semibold`}>{num2(total.lucroContratos)}</TableCell>
                          {RUBRICAS.map((r) => <TableCell key={r.id} className={`${CEL} font-semibold`}><ValorDetalhavel valor={total.adm[r.id]} onClick={() => abrirAdm(r.label, [r.id], mesesDaTabela, total.adm[r.id])} /></TableCell>)}
                          <TableCell className={`${CEL} font-semibold`}><ValorDetalhavel valor={total.totalAdm} onClick={() => abrirAdm("Total Desp. Adm", null, mesesDaTabela, total.totalAdm)} /></TableCell>
                          <TableCell className={`${CEL} font-semibold ${total.resultado < 0 ? "text-red-600" : ""}`}>{num2(total.resultado)}</TableCell>
                          <TableCell className={`${CEL} font-semibold`}>{pctTxt(total.margem)}</TableCell>
                          <TableCell className="px-2 py-1.5 text-center"><StatusPill status={total.status} /></TableCell>
                        </TableRow>
                      </TableFooter>
                    )}
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="adm">
              <Card>
                <CardContent className="p-0">
                  {contratoId !== TODOS ? (
                    <p className="p-6 text-center text-xs text-muted-foreground">Escolha "Todos os contratos" para ver as despesas administrativas.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-auto px-2 py-1.5">Classificação</TableHead>
                          <TableHead className="h-auto px-2 py-1.5">Rubrica</TableHead>
                          <TableHead className={CAB}>Lançamentos</TableHead>
                          <TableHead className={CAB}>Valor (R$)</TableHead>
                          <TableHead className={CAB}>% do total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {porClassificacao.length === 0 && (
                          <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Sem despesas administrativas lançadas no período.</TableCell></TableRow>
                        )}
                        {porClassificacao.map((x) => {
                          const soma = porClassificacao.reduce((s, y) => s + y.valor, 0);
                          return (
                            <TableRow key={x.classificacao}>
                              <TableCell className="px-2 py-1.5">{x.classificacao}</TableCell>
                              <TableCell className="px-2 py-1.5 text-muted-foreground">{RUBRICAS.find((r) => r.id === x.rubrica)?.label}</TableCell>
                              <TableCell className={CEL}>{x.lancamentos.toLocaleString("pt-BR")}</TableCell>
                              <TableCell className={CEL}>{num2(x.valor)}</TableCell>
                              <TableCell className={CEL}>{soma > 0 ? `${((x.valor / soma) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : "—"}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                  <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Mostra só o que está lançado no Fluxo de Caixa (pago ou programado) nos meses do período. A projeção por média entra nos totais, não nesta lista.</p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="socios">
              <Card>
                <CardContent className="p-0">
                  {contratoId !== TODOS ? (
                    <p className="p-6 text-center text-xs text-muted-foreground">Escolha "Todos os contratos" para ver o resumo com sócios: despesa de sócio não pertence a contrato.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-auto px-2 py-1.5 align-bottom">Mês</TableHead>
                          <TableHead className={CAB}><TituloComFormula titulo="Resultado Final (R$)" formula="Lucro dos Contratos − Total Desp. Adm. É o resultado SEM as despesas dos sócios (mesmo valor da aba Resumo Mensal)." /></TableHead>
                          {nomesSocios.map((s) => <TableHead key={s} className={CAB}><TituloComFormula titulo={`${s} (R$)`} formula={s === ROTULO_INVESTIMENTOS
                            ? <><p>Todas as saídas do Fluxo de Caixa lançadas nos contratos <strong>INVESTIMENTOS …</strong> (AGPS, HAGG, SN…), seja qual for a classificação. Ficam fora do Resultado Final e saem aqui, antes do Lucro Líquido Final.</p><p>Meses projetados: o lançado ou a média dos últimos 3 meses, o maior.</p></>
                            : <><p>Saídas do Fluxo de Caixa lançadas no contrato <strong>ADMINISTRATIVO SÓCIOS - {s.toUpperCase()}</strong>, inclusive distribuição de lucros. Transferência, aplicação, empréstimo e financiamento ficam de fora.</p><p>Meses projetados: o lançado ou a média dos últimos 3 meses, o maior.</p></>} /></TableHead>)}
                          <TableHead className={CAB}><TituloComFormula titulo="Lucro Líquido Final (R$)" formula="Resultado Final − despesas de todos os sócios e os investimentos no mês." /></TableHead>
                          <TableHead className={`${CAB} text-center`}><TituloComFormula alinhar="center" titulo="Status" formula={<><p>Pela margem do Lucro Líquido Final sobre o Lucro dos Contratos:</p><FaixasStatus /></>} /></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linhas.length === 0 && (
                          <TableRow><TableCell colSpan={nomesSocios.length + 4} className="text-center text-muted-foreground py-8">Nenhum mês no período.</TableCell></TableRow>
                        )}
                        {linhas.map((l) => (
                          <TableRow key={l.mes}>
                            <TableCell className="px-2 py-1.5 whitespace-nowrap font-medium">
                              {rotuloMes(l.mes)}
                              {l.projetado && <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[9px] font-medium text-sky-700 border-sky-300">Projetado</Badge>}
                            </TableCell>
                            <TableCell className={`${CEL} font-semibold ${l.resultado < 0 ? "text-red-600" : ""}`}>{num2(l.resultado)}</TableCell>
                            {nomesSocios.map((s) => <TableCell key={s} className={CEL}><ValorDetalhavel valor={l.socios[s] ?? 0} onClick={() => abrirSocio(s, [l.mes], l.socios[s] ?? 0)} /></TableCell>)}
                            <TableCell className={`${CEL} font-semibold ${l.lucroLiquido < 0 ? "text-red-600" : ""}`}>{num2(l.lucroLiquido)}</TableCell>
                            <TableCell className="px-2 py-1.5 text-center"><StatusPill status={l.statusLiquido} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      {linhas.length > 0 && (
                        <TableFooter>
                          <TableRow>
                            <TableCell className="px-2 py-1.5 font-semibold">Total</TableCell>
                            <TableCell className={`${CEL} font-semibold ${total.resultado < 0 ? "text-red-600" : ""}`}>{num2(total.resultado)}</TableCell>
                            {nomesSocios.map((s) => <TableCell key={s} className={`${CEL} font-semibold`}><ValorDetalhavel valor={total.socios[s] ?? 0} onClick={() => abrirSocio(s, mesesDaTabela, total.socios[s] ?? 0)} /></TableCell>)}
                            <TableCell className={`${CEL} font-semibold ${total.lucroLiquido < 0 ? "text-red-600" : ""}`}>{num2(total.lucroLiquido)}</TableCell>
                            <TableCell className="px-2 py-1.5 text-center"><StatusPill status={total.statusLiquido} /></TableCell>
                          </TableRow>
                        </TableFooter>
                      )}
                    </Table>
                  )}
                  <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
                    Despesas dos sócios = todas as saídas do Fluxo de Caixa nos contratos "ADMINISTRATIVO SÓCIOS - nome do sócio", seja qual for a classificação, {base === "pagamento" ? "pelo mês do pagamento" : "pelo mês da competência"}. Os contratos "INVESTIMENTOS …" seguem a mesma regra e formam a coluna Investimentos. Tudo isso fica fora do Resultado Final (resumo mensal sem sócios) e entra aqui, depois dele, para chegar ao Lucro Líquido Final.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="empresa">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-auto px-2 py-1.5">Empresa</TableHead>
                        <TableHead className={CAB}>Lucro dos Contratos (R$)</TableHead>
                        <TableHead className={CAB}>Total Desp. Adm (R$)</TableHead>
                        <TableHead className={CAB}>Resultado Final (R$)</TableHead>
                        <TableHead className={CAB}>Margem Final (%)</TableHead>
                        <TableHead className={`${CAB} text-center`}>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {porEmpresa.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum valor no período.</TableCell></TableRow>
                      )}
                      {porEmpresa.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="px-2 py-1.5 font-medium">{e.nome}</TableCell>
                          <TableCell className={CEL}>{num2(e.lucroContratos)}</TableCell>
                          <TableCell className={CEL}>{num2(e.totalAdm)}</TableCell>
                          <TableCell className={`${CEL} font-semibold ${e.resultado < 0 ? "text-red-600" : ""}`}>{num2(e.resultado)}</TableCell>
                          <TableCell className={CEL}>{pctTxt(e.margem)}</TableCell>
                          <TableCell className="px-2 py-1.5 text-center"><StatusPill status={e.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Fórmula do fechamento</p>
              <p className="text-xs">Lucro dos Contratos − Total de Despesas Administrativas = Resultado Final da Empresa (sem sócios). Resultado Final − despesas dos sócios = Lucro Líquido Final (aba Resumo Mensal com Sócios). Meses até o atual vêm do que já aconteceu (notas e Fluxo de Caixa); os seguintes são projetados e aparecem marcados.</p>
            </div>
          </div>
        </>
      )}

      <DetalheDespesaDialog detalhe={detalhe} onClose={() => setDetalhe(null)} />
    </div>
  );
}
