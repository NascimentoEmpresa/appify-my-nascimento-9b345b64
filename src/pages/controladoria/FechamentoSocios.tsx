import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, HandCoins, Landmark, Lock, LockOpen, PieChart as PieIcon, Percent, Printer, Settings2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  useCompetenciasFechadas, useFecharCompetencia, usePercentuaisDoAno, useReabrirCompetencia, useSalvarComplementoPago, useSalvarPercentuaisDoMes, useSalvarSocios, useSociosConfig,
  type SalvarSocioInput,
} from "@/hooks/useFechamentoSocios";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { useLeituraCompartilhada } from "./faturamento/leituraCompartilhada";
import { rotuloMes } from "./faturamento/useBaseFaturamento";
import { TituloComFormula } from "./faturamento/Rentabilidade";
import { ROTULO_BASE } from "./faturamento/regras";
import { lancamentosConsumoEmpresa, lancamentosDeRetirada, useDadosFechamentoSocios } from "./fechamento-socios/useDadosFechamentoSocios";
import { DialogComposicaoLucro, DialogRetiradasSocio } from "./fechamento-socios/Detalhes";
import {
  calcularMes, fotoDoFechamento, linhaDoHistorico, pendenciasParaFechar, resultadoDoFechamento, resumoPorSocio, ROTULO_TIPO_LANCAMENTO, somarMeses,
  type ResultadoMes, type SocioConfig, type TipoLancamento,
} from "./fechamento-socios/regras";

// SIS-2026-0872: Fechamento dos Sócios (pedido do Ruan). Regras e origem dos números em fechamento-socios/regras.ts. Só lê o Fechamento da Empresa
// (que já existe) e guarda o que é próprio daqui: sócios, percentuais, fechamento da competência e complemento pago. Três abas = as três telas pedidas.
export const MENU_FECHAMENTO_SOCIOS = "fechamento-socios";

const TODOS = "todos";
const CORES = ["#2563eb", "#f59e0b", "#16a34a", "#9333ea", "#e11d48", "#0891b2", "#64748b"];
const pct2 = (n: number) => `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const mil = (v: number) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M` : `${Math.round(v / 1_000)}k`);
const sigla = (nome: string) => nome.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const mesCurto = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;
const dataBR = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR") : "—");
const CAB = "h-auto px-2 py-1.5 text-right align-bottom whitespace-normal leading-tight";
const CEL = "px-2 py-1.5 align-middle text-right whitespace-nowrap";

export default function FechamentoSocios() {
  const { base, setBase, codigo } = useLeituraCompartilhada();
  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = `${anoAtual}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const [ano, setAno] = useState(anoAtual);
  const [periodo, setPeriodo] = useState(TODOS);
  const [aba, setAba] = useState("distribuicao");

  const { data: podeConfigurar = false } = useScreenAccess(MENU_FECHAMENTO_SOCIOS, "alterar");
  const { data: podeFechar = false } = useScreenAccess(MENU_FECHAMENTO_SOCIOS, "aprovar");

  const dados = useDadosFechamentoSocios(ano, base, codigo);
  const { data: sociosCadastrados = [], error: erroSocios } = useSociosConfig();
  const { data: pctAno = new Map<string, number>() } = usePercentuaisDoAno(ano);
  const { data: fechadas = new Map() } = useCompetenciasFechadas(ano);

  // Sem sócios cadastrados, os das colunas do Fechamento da Empresa entram como provisórios (percentual 0, sem vínculo): as retiradas deles já aparecem.
  const cadastroFeito = sociosCadastrados.some((s) => s.ativo);
  const socios: SocioConfig[] = useMemo(
    () => (cadastroFeito ? sociosCadastrados : dados.nomesSocios.map((n) => ({ id: `provisorio:${n}`, nome: n, empregadoIds: [], percentualPadrao: 0, ativo: true }))),
    [cadastroFeito, sociosCadastrados, dados.nomesSocios],
  );
  const resultados = useMemo(() => {
    const m = new Map<string, ResultadoMes>();
    for (const e of dados.entradas) {
      const f = fechadas.get(e.mes);
      if (f) { m.set(e.mes, resultadoDoFechamento(e.mes, f)); continue; }
      const pcts = new Map<string, number>();
      for (const s of socios) { const v = pctAno.get(`${s.id}|${e.mes}`); if (v !== undefined) pcts.set(s.id, v); }
      m.set(e.mes, calcularMes(e, socios, pcts, dados.linhasIntegrante));
    }
    return m;
  }, [dados.entradas, dados.linhasIntegrante, socios, pctAno, fechadas]);

  // meses que contam: os já realizados (o projetado do Fechamento da Empresa não é lucro para distribuir)
  const mesesRealizados = useMemo(() => dados.entradas.filter((e) => !dados.projetadoPorMes.get(e.mes) || fechadas.has(e.mes)).map((e) => e.mes), [dados.entradas, dados.projetadoPorMes, fechadas]);
  const mesesVisiveis = useMemo(() => (periodo === TODOS ? mesesRealizados : mesesRealizados.filter((m) => m === periodo)), [periodo, mesesRealizados]);
  const doPeriodo = useMemo(() => mesesVisiveis.map((m) => resultados.get(m)).filter((r): r is ResultadoMes => !!r), [mesesVisiveis, resultados]);
  const total = useMemo(() => somarMeses(doPeriodo), [doPeriodo]);
  const mesUnico = periodo !== TODOS ? doPeriodo[0] ?? null : null;
  const mesUnicoFechado = !!mesUnico && fechadas.has(mesUnico.mes);
  const semIntegrante = useMemo(() => doPeriodo.reduce((s, r) => s + r.consumoEmpresa.semIntegrante, 0), [doPeriodo]);
  const todosPercentuaisOk = doPeriodo.length > 0 && doPeriodo.every((r) => r.percentualOk);
  const somaPercentualKpi = mesUnico ? mesUnico.somaPercentual : todosPercentuaisOk ? 100 : null;
  const nomesDosSocios = useMemo(() => socios.filter((s) => s.ativo), [socios]);

  const [configAberta, setConfigAberta] = useState(false);
  // janelas de detalhe: de onde vem cada valor
  const [retiradaSocio, setRetiradaSocio] = useState<string | null>(null);
  const [composicaoAberta, setComposicaoAberta] = useState(false);
  const lancamentosRetirada = useMemo(() => lancamentosDeRetirada(dados, socios, new Set(mesesVisiveis)), [dados, socios, mesesVisiveis]);
  const lancamentosConsumo = useMemo(() => lancamentosConsumoEmpresa(dados, socios, new Set(mesesVisiveis)), [dados, socios, mesesVisiveis]);
  const semSocios = !dados.carregando && !cadastroFeito;

  const anos = useMemo(() => [anoAtual + 1, anoAtual, anoAtual - 1, anoAtual - 2], [anoAtual]);
  const opcoesMes = useMemo(() => mesesRealizados, [mesesRealizados]);

  return (
    <AcessoGate menu={MENU_FECHAMENTO_SOCIOS} acao="visualizar" fallback={<div className="p-6 text-sm text-muted-foreground">Sem acesso a esta tela.</div>}>
      <div className="space-y-5">
        <PageHeader
          module="Controladoria"
          breadcrumb={["Controladoria", "Fechamento dos Sócios"]}
          title="Fechamento dos Sócios"
          subtitle="Apuração do resultado gerencial, divisão do lucro por percentual entre os sócios e conciliação com as retiradas antecipadas do período."
          actions={
            <>
              {podeConfigurar && <Button variant="outline" onClick={() => setConfigAberta(true)}><Settings2 className="mr-2 h-4 w-4" /> Sócios e percentuais</Button>}
              <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Imprimir</Button>
            </>
          }
        />

        <Card className="print:hidden">
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div>
              <Label className="text-xs">Ano</Label>
              <Select value={String(ano)} onValueChange={(v) => { setAno(Number(v)); setPeriodo(TODOS); }}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>{anos.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Despesas por</Label>
              <div className="flex overflow-hidden rounded-md border">
                {(["competencia", "pagamento"] as const).map((b) => (
                  <button key={b} type="button" onClick={() => setBase(b)} className={`px-3 py-2 text-xs ${base === b ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>{ROTULO_BASE[b]}</button>
                ))}
              </div>
            </div>
            <div className="min-w-[200px]">
              <Label className="text-xs">Período</Label>
              <Select value={periodo} onValueChange={setPeriodo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos os períodos (realizados)</SelectItem>
                  {opcoesMes.map((m) => <SelectItem key={m} value={m}>{rotuloMes(m)}{fechadas.has(m) ? " — fechado" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => setPeriodo(TODOS)}>Limpar</Button>
            <p className="basis-full text-[11px] text-muted-foreground">
              Lê o Fechamento da Empresa (todas as empresas e contratos). Só entram os meses já realizados; o mês fechado vale o que foi gravado no fechamento.
            </p>
          </CardContent>
        </Card>

        {dados.erro != null && <Card className="border-destructive/40"><CardContent className="p-4 text-sm text-destructive">Não foi possível carregar os dados: {(dados.erro as { message?: string })?.message ?? "erro desconhecido"}</CardContent></Card>}
        {erroSocios != null && <Card className="border-destructive/40"><CardContent className="p-4 text-sm text-destructive">Não foi possível carregar o cadastro dos sócios: {(erroSocios as { message?: string })?.message || "erro desconhecido"}</CardContent></Card>}
        {dados.carregando && <p className="text-sm text-muted-foreground">Carregando...</p>}
        {semSocios && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20"><CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <span className="flex-1">Sócios ainda não cadastrados: abaixo aparecem só as retiradas já lançadas nas colunas do Fechamento da Empresa. Defina o percentual de cada sócio para ver a distribuição e o saldo.</span>
            {podeConfigurar ? <Button size="sm" onClick={() => setConfigAberta(true)}>Cadastrar sócios</Button> : <span className="text-xs text-muted-foreground">Peça a quem tem a ação “sócios e percentuais”.</span>}
          </CardContent></Card>
        )}
        {semIntegrante > 0 && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20"><CardContent className="p-3 text-xs">
            <strong>{fmtMoney(semIntegrante)}</strong> de Investimentos/Obras Adm no período estão <strong>sem integrante</strong> (ou com um colaborador que não é sócio). Contam como gasto da Empresa
            e saem do lucro antes da divisão; para atribuir a um sócio, corrija o integrante do lançamento no Fluxo de Caixa.
          </CardContent></Card>
        )}
        {dados.divergencias.length > 0 && (
          <Card className="border-red-300 bg-red-50 dark:bg-red-950/20"><CardContent className="p-3 text-xs">
            <strong>Atenção:</strong> Investimentos/Obras Adm somados por integrante não batem com as colunas do Fechamento da Empresa em{" "}
            {dados.divergencias.slice(0, 6).map((d) => `${rotuloMes(d.mes)} (${d.tipo === "obras" ? "Obras Adm" : "Investimentos"}: ${fmtMoney(d.porIntegrante)} × ${fmtMoney(d.fechamento)})`).join("; ")}
            {dados.divergencias.length > 6 ? "…" : ""}. Confira antes de fechar.
          </CardContent></Card>
        )}
        {dados.viewsSemIntegrante.length > 0 && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20"><CardContent className="p-3 text-xs">
            Fonte sem o campo integrante neste ambiente ({dados.viewsSemIntegrante.join(", ")}): os lançamentos dela entram como “sem integrante”.
          </CardContent></Card>
        )}

        <details className="group rounded-lg border bg-muted/30 px-4 py-2 text-xs leading-relaxed print:hidden">
          <summary className="cursor-pointer select-none text-sm font-semibold">Como ler esta tela (de onde vem cada valor)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li><strong>Resultado do Período</strong> = Resultado após Outras Receitas − Tributos sobre o Resultado, da aba “Resumo Mensal com Sócios” do Fechamento da Empresa. Só meses realizados.</li>
            <li><strong>(−) Consumo da Empresa</strong> = Investimentos e Obras Adm cujo integrante é “Empresa” (e o que está sem integrante). Sai do lucro antes da divisão.</li>
            <li><strong>Lucro a Distribuir</strong> = Resultado do Período − Consumo da Empresa. Cada sócio recebe o seu percentual.</li>
            <li><strong>Retiradas Antecipadas</strong> de cada sócio = a coluna dele no Fechamento da Empresa (contrato ADMINISTRATIVO SÓCIOS dele) + Investimentos e Obras Adm em que ele é o integrante. Por isso o valor aqui pode ser maior que o da coluna: a diferença é Investimentos/Obras Adm com ele como integrante.</li>
            <li><strong>Saldo a Retirar (complemento)</strong> = parte do lucro do sócio − retiradas antecipadas. Negativo = já retirou mais do que a parte dele no período.</li>
            <li>Os valores sublinhados ou clicáveis abrem os lançamentos que os formam. Mês fechado vale o que foi gravado no fechamento; mês aberto, o cálculo de hoje.</li>
          </ol>
        </details>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <KpiTile label="Resultado do Período" valor={fmtMoney(total.resultadoAntesRetiradas)} sub="Clique para ver a conta mês a mês" icon={<Landmark />} cor="sky" onClick={() => setComposicaoAberta(true)}
            info={<><span><strong>Resultado após Outras Receitas − Tributos sobre o Resultado</strong> (IRPJ e CSLL), como na aba “Resumo Mensal com Sócios” do Fechamento da Empresa.</span><span className="block">É o resultado <strong>antes</strong> das colunas dos sócios, de Investimentos e de Obras Adm: no Resultado Gerencial Líquido de lá elas já foram descontadas; aqui elas são as retiradas de cada sócio.</span><span className="block">Meses projetados do Fechamento da Empresa não entram: só os realizados.</span></>} />
          <KpiTile label="Percentual Total de Distribuição" valor={somaPercentualKpi === null ? "Revisar" : pct2(somaPercentualKpi)} sub={somaPercentualKpi === 100 ? "Percentual configurado entre os sócios" : "Os percentuais precisam somar 100%"} icon={<Percent />} cor="slate"
            valorClass={somaPercentualKpi === 100 ? undefined : "text-amber-600"}
            info={<><span>Soma dos percentuais de divisão dos sócios ativos. Precisa dar <strong>100%</strong> para fechar uma competência.</span><span className="block">O padrão vale para todos os meses; um mês específico pode ter percentual próprio (aba Distribuição, escolhendo o mês).</span></>} />
          <KpiTile label="Total a Distribuir (Lucro)" valor={fmtMoney(total.lucroDistribuir)} sub={`Após ${fmtMoney(total.consumoEmpresa)} consumidos pela Empresa · clique`} icon={<HandCoins />} cor="emerald" onClick={() => setComposicaoAberta(true)}
            valorClass={total.lucroDistribuir < 0 ? "text-red-600" : "text-emerald-600"}
            info={<><span><strong>Resultado do Período − o que a Empresa consumiu</strong> em Investimentos e Obras Adm (lançamentos com integrante “Empresa” ou sem integrante). É o que se divide entre os sócios pelo percentual.</span><span className="block">Mês negativo é abatido: o total do período soma tudo.</span></>} />
          <KpiTile label="Total de Retiradas Antecipadas" valor={fmtMoney(total.totalRetiradas)} sub="Despesas dos sócios + Investimentos e Obras Adm por integrante" icon={<Wallet />} cor="amber" valorClass="text-orange-600" onClick={() => setAba("retiradas")}
            info={<><span>Soma, de cada sócio, de: <strong>(1)</strong> a coluna dele no Fechamento da Empresa (saídas do contrato ADMINISTRATIVO SÓCIOS dele, inclusive distribuição de lucros; transferência, aplicação, empréstimo e financiamento ficam de fora) e <strong>(2)</strong> as saídas de Investimentos e Obras Adm em que ele é o <strong>integrante</strong>.</span><span className="block">Clique para ver os lançamentos.</span></>} />
          <KpiTile label="Saldo a Retirar (Complemento)" valor={fmtMoney(total.totalSaldo)} sub="Lucro dos sócios menos as retiradas" icon={<Wallet />} cor="sky" valorClass={total.totalSaldo < 0 ? "text-red-600" : "text-blue-700"} />
        </div>

        <Tabs value={aba} onValueChange={setAba}>
          <TabsList>
            <TabsTrigger value="distribuicao">Distribuição por Sócio</TabsTrigger>
            <TabsTrigger value="retiradas">Retiradas Antecipadas (Detalhado)</TabsTrigger>
            <TabsTrigger value="historico">Histórico de Distribuições</TabsTrigger>
          </TabsList>

          <TabsContent value="distribuicao" className="mt-4">
            <AbaDistribuicao total={total} mesUnico={mesUnico} fechado={mesUnicoFechado} podeConfigurar={podeConfigurar} socios={nomesDosSocios} pctAno={pctAno} onRetiradas={setRetiradaSocio} onComposicao={() => setComposicaoAberta(true)} />
          </TabsContent>
          <TabsContent value="retiradas" className="mt-4">
            <AbaRetiradas dados={dados} socios={socios} meses={new Set(mesesVisiveis)} />
          </TabsContent>
          <TabsContent value="historico" className="mt-4">
            <AbaHistorico ano={ano} entradas={dados.entradas.map((e) => e.mes)} resultados={resultados} mesesRealizados={new Set(mesesRealizados)} fechadas={fechadas} podeFechar={podeFechar} mesAtual={mesAtual} />
          </TabsContent>
        </Tabs>

        {doPeriodo.length > 0 && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-4 p-4">
              <p className="min-w-[160px] text-base font-bold">Resumo do Fechamento</p>
              {[
                ["Resultado do Período", total.resultadoAntesRetiradas, ""],
                ["(−) Consumo da Empresa", total.consumoEmpresa, "text-orange-600"],
                ["(=) Lucro a Distribuir", total.lucroDistribuir, "text-emerald-600"],
                ["(−) Retiradas Antecipadas", total.totalRetiradas, "text-red-600"],
                ["(=) Saldo a Retirar", total.totalSaldo, total.totalSaldo < 0 ? "text-red-600" : "text-emerald-600"],
              ].map(([r, v, c]) => (
                <div key={r as string} className="min-w-[150px]">
                  <p className="text-xs text-muted-foreground">{r as string}</p>
                  <p className={`text-lg font-bold ${c as string}`}>{fmtMoney(v as number)}</p>
                </div>
              ))}
              <div className={`ml-auto flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${todosPercentuaisOk ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30" : "bg-amber-50 text-amber-700 dark:bg-amber-950/30"}`}>
                {todosPercentuaisOk ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {todosPercentuaisOk ? `Distribuição configurada · 100,00% entre os ${nomesDosSocios.length} sócios` : "Percentuais fora de 100% em algum mês"}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <DialogRetiradasSocio socio={total.socios.find((x) => x.socioId === retiradaSocio) ?? null} meses={mesesVisiveis} lancamentos={lancamentosRetirada} onClose={() => setRetiradaSocio(null)} />
      <DialogComposicaoLucro aberto={composicaoAberta} meses={mesesVisiveis} total={total} resultados={doPeriodo} consumo={lancamentosConsumo} onClose={() => setComposicaoAberta(false)} />
      {configAberta && <ConfigSocios aberto={configAberta} onClose={() => setConfigAberta(false)} nomesDetectados={dados.nomesSocios} socios={sociosCadastrados} />}
    </AcessoGate>
  );
}

// ── Aba 1: Distribuição por Sócio ───────────────────────────────────────────────────────────────────────────────────────────────────
function AbaDistribuicao({ total, mesUnico, fechado, podeConfigurar, socios, pctAno, onRetiradas, onComposicao }: {
  total: ReturnType<typeof somarMeses>; mesUnico: ResultadoMes | null; fechado: boolean; podeConfigurar: boolean; socios: SocioConfig[]; pctAno: Map<string, number>;
  onRetiradas: (socioId: string) => void; onComposicao: () => void;
}) {
  const salvarMes = useSalvarPercentuaisDoMes();
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  useEffect(() => { setRascunho({}); }, [mesUnico?.mes]);
  const editavel = !!mesUnico && !fechado && podeConfigurar && !socios.some((x) => x.id.startsWith("provisorio:")); // sócio provisório (ainda sem cadastro) não tem percentual para gravar
  const valorPct = (s: SocioConfig) => rascunho[s.id] ?? String(mesUnico?.socios.find((x) => x.socioId === s.id)?.percentual ?? s.percentualPadrao);
  const somaRascunho = Math.round(socios.reduce((t, s) => t + (Number(String(valorPct(s)).replace(",", ".")) || 0), 0) * 100) / 100;
  const dirty = Object.keys(rascunho).length > 0;

  async function salvar() {
    if (!mesUnico) return;
    try {
      await salvarMes.mutateAsync({ mes: mesUnico.mes, percentuais: socios.map((s) => ({ socioId: s.id, percentual: Number(String(valorPct(s)).replace(",", ".")) || 0 })) });
      toast.success("Percentuais do mês salvos.");
      setRascunho({});
    } catch (e) { toast.error((e as { message?: string })?.message || "Erro ao salvar os percentuais."); }
  }
  async function voltarAoPadrao() {
    if (!mesUnico) return;
    try {
      await salvarMes.mutateAsync({ mes: mesUnico.mes, percentuais: socios.map((s) => ({ socioId: s.id, percentual: null })) });
      toast.success("O mês voltou a usar o percentual padrão.");
      setRascunho({});
    } catch (e) { toast.error((e as { message?: string })?.message || "Erro ao salvar."); }
  }
  const mexido = !!mesUnico && socios.some((s) => pctAno.has(`${s.id}|${mesUnico.mes}`));

  const linhas = total.socios;
  const grafico = linhas.filter((s) => s.valorLucro > 0).map((s) => ({ nome: s.nome, valor: s.valorLucro }));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2"><CardTitle className="text-base">Distribuição do Lucro por Sócio</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sócio</TableHead>
                <TableHead className={CAB}><TituloComFormula titulo="Percentual de Divisão" formula={<><span>Fatia do sócio no Lucro a Distribuir. O padrão está em “Sócios e percentuais”; um mês pode ter percentual próprio.</span><span className="block">Em vários meses é o percentual efetivo: valor do lucro do sócio ÷ lucro total do período.</span></>} /></TableHead>
                <TableHead className={CAB}><TituloComFormula titulo="Valor do Lucro a Distribuir (R$)" formula={<><span><strong>Percentual × Lucro a Distribuir</strong> do mês (centavos distribuídos para a soma fechar o lucro).</span><span className="block">O Lucro a Distribuir é o Resultado do Período menos o consumo da Empresa. Clique no valor para ver a conta.</span></>} /></TableHead>
                <TableHead className={CAB}><TituloComFormula titulo="Retiradas Antecipadas (R$)" formula={<><span>Coluna do sócio no Fechamento da Empresa (contrato ADMINISTRATIVO SÓCIOS dele) <strong>+</strong> Investimentos e Obras Adm em que ele é o integrante.</span><span className="block">Clique no valor para ver a composição e os lançamentos.</span></>} /></TableHead>
                <TableHead className={CAB}><TituloComFormula titulo="Saldo a Retirar (Complemento) (R$)" formula={<><span><strong>Valor do lucro − Retiradas antecipadas.</strong></span><span className="block">Positivo: ainda pode retirar. Negativo: já retirou mais do que a parte dele no período.</span></>} /></TableHead>
                <TableHead className={CAB}><TituloComFormula titulo="% do Total" formula={<span>Valor do lucro do sócio ÷ Lucro a Distribuir do período.</span>} /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Sem dados para o período.</TableCell></TableRow>}
              {linhas.map((s, i) => {
                const config = socios.find((x) => x.id === s.socioId);
                return (
                  <TableRow key={s.socioId}>
                    <TableCell className="font-medium"><span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] text-white" style={{ background: CORES[i % CORES.length] }}>{sigla(s.nome)}</span>{s.nome}</TableCell>
                    <TableCell className={CEL}>
                      {editavel && config ? (
                        <span className="inline-flex items-center gap-1">
                          <Input className="h-8 w-20 text-right" inputMode="decimal" value={valorPct(config)} onChange={(e) => setRascunho((r) => ({ ...r, [config.id]: e.target.value }))} />%
                        </span>
                      ) : pct2(s.percentualEfetivo)}
                    </TableCell>
                    <TableCell className={CEL}>
                      <button type="button" onClick={onComposicao} title="Ver como o Lucro a Distribuir é formado" className="underline decoration-dotted underline-offset-2 hover:text-primary print:no-underline">{fmtMoney(s.valorLucro)}</button>
                    </TableCell>
                    <TableCell className={CEL}>
                      {s.retiradas ? (
                        <button type="button" onClick={() => onRetiradas(s.socioId)} title={`Coluna do sócio ${fmtMoney(s.retiradaColuna)} + Investimentos ${fmtMoney(s.retiradaInvestimentos)} + Obras Adm ${fmtMoney(s.retiradaObras)}`} className="underline decoration-dotted underline-offset-2 hover:text-primary print:no-underline">{fmtMoney(s.retiradas)}</button>
                      ) : fmtMoney(s.retiradas)}
                    </TableCell>
                    <TableCell className={`${CEL} font-semibold ${s.saldo < 0 ? "text-red-600" : "text-emerald-700"}`}>{fmtMoney(s.saldo)}</TableCell>
                    <TableCell className={CEL}>{pct2(total.lucroDistribuir !== 0 ? (s.valorLucro / total.lucroDistribuir) * 100 : 0)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            {linhas.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className={`${CEL} font-semibold`}>{editavel ? pct2(somaRascunho) : pct2(linhas.reduce((t, s) => t + s.percentualEfetivo, 0))}</TableCell>
                  <TableCell className={`${CEL} font-semibold`}>{fmtMoney(total.lucroDistribuir)}</TableCell>
                  <TableCell className={`${CEL} font-semibold`}>{fmtMoney(total.totalRetiradas)}</TableCell>
                  <TableCell className={`${CEL} font-semibold`}>{fmtMoney(total.totalSaldo)}</TableCell>
                  <TableCell className={CEL}>100,00%</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {mesUnico
              ? fechado ? "Mês fechado: vale o que foi gravado no fechamento." : editavel ? "Ajuste o percentual deste mês (vale só para ele; o padrão está em “Sócios e percentuais”)." : "Percentual do mês."
              : "Vários meses: o percentual mostrado é a fatia efetiva de cada sócio no lucro do período. Escolha um mês para ajustar o percentual dele."}
          </p>
          {editavel && (
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              {Math.abs(somaRascunho - 100) > 0.005 && <span className="text-xs text-amber-600">Soma {pct2(somaRascunho)} — precisa fechar 100%.</span>}
              {mexido && <Button variant="outline" size="sm" onClick={voltarAoPadrao} disabled={salvarMes.isPending}>Voltar ao padrão</Button>}
              <Button size="sm" onClick={salvar} disabled={!dirty || salvarMes.isPending || Math.abs(somaRascunho - 100) > 0.005}>{salvarMes.isPending ? "Salvando..." : "Salvar percentuais do mês"}</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="flex flex-col">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><PieIcon className="h-4 w-4" /> Distribuição do Lucro</CardTitle></CardHeader>
        <CardContent className="min-h-[18rem] flex-1 pb-4">
          {grafico.length === 0 ? <p className="pt-10 text-center text-sm text-muted-foreground">Sem lucro a distribuir no período.</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={grafico} dataKey="valor" nameKey="nome" innerRadius="58%" outerRadius="95%" paddingAngle={1}>
                  {grafico.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ChartTooltip formatter={(v: number) => fmtMoney(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Aba 2: Retiradas Antecipadas (Detalhado) ────────────────────────────────────────────────────────────────────────────────────────
function AbaRetiradas({ dados, socios, meses }: { dados: ReturnType<typeof useDadosFechamentoSocios>; socios: SocioConfig[]; meses: Set<string> }) {
  const [socioFiltro, setSocioFiltro] = useState(TODOS);
  const [tipoFiltro, setTipoFiltro] = useState(TODOS);
  const [busca, setBusca] = useState("");
  const todos = useMemo(() => lancamentosDeRetirada(dados, socios, meses), [dados, socios, meses]);
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return todos.filter((l) => (socioFiltro === TODOS || l.socioId === socioFiltro) && (tipoFiltro === TODOS || l.tipo === tipoFiltro)
      && (!q || [l.descricao, l.origem, l.classificacao, String(l.valor)].join(" ").toLowerCase().includes(q)));
  }, [todos, socioFiltro, tipoFiltro, busca]);
  const totalLista = Math.round(lista.reduce((s, l) => s + l.valor, 0) * 100) / 100;
  const resumo = useMemo(() => resumoPorSocio(lista), [lista]);
  const COR_TIPO: Record<TipoLancamento, string> = { coluna_socio: "bg-orange-100 text-orange-800", investimentos: "bg-violet-100 text-violet-800", obras: "bg-rose-100 text-rose-800" };
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2"><CardTitle className="text-base">Retiradas Antecipadas — Detalhado</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[160px]">
              <Label className="text-xs">Sócio</Label>
              <Select value={socioFiltro} onValueChange={setSocioFiltro}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={TODOS}>Todos os sócios</SelectItem>{socios.filter((s) => s.ativo).map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="min-w-[160px]">
              <Label className="text-xs">Tipo</Label>
              <Select value={tipoFiltro} onValueChange={setTipoFiltro}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={TODOS}>Todos os tipos</SelectItem>{(Object.keys(ROTULO_TIPO_LANCAMENTO) as TipoLancamento[]).map((t) => <SelectItem key={t} value={t}>{ROTULO_TIPO_LANCAMENTO[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="min-w-[220px] flex-1">
              <Label className="text-xs">Buscar</Label>
              <Input placeholder="Descrição, origem, classificação ou valor" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
          </div>
          <div className="max-h-[55vh] overflow-y-auto overflow-x-hidden">
            <Table className="w-full table-fixed text-xs">
              <TableHeader className="sticky top-0 bg-muted/60">
                <TableRow><TableHead className="w-[9%]"><TituloComFormula alinhar="left" titulo="Data" formula={<span>Data do pagamento no Fluxo de Caixa.</span>} /></TableHead>
                  <TableHead className="w-[11%]"><TituloComFormula alinhar="left" titulo="Sócio" formula={<span>Despesa do sócio: o dono é o do contrato ADMINISTRATIVO SÓCIOS. Investimento e Obra adm: o dono é o <strong>integrante</strong> do lançamento (os cadastros do colaborador vinculado ao sócio).</span>} /></TableHead>
                  <TableHead className="w-[12%]"><TituloComFormula alinhar="left" titulo="Tipo" formula={<><span><strong>Despesa do sócio</strong>: saída do contrato ADMINISTRATIVO SÓCIOS dele (inclusive distribuição de lucros; transferência, aplicação, empréstimo e financiamento ficam de fora).</span><span className="block"><strong>Investimento / Obra adm</strong>: saída dos contratos INVESTIMENTOS / OBRAS ADM em que ele é o integrante.</span></>} /></TableHead>
                  <TableHead className="w-[21%]">Descrição</TableHead>
                  <TableHead className="w-[16%]"><TituloComFormula alinhar="left" titulo="Centro de custo / origem" formula={<span>O contrato em que a saída foi lançada no Fluxo de Caixa.</span>} /></TableHead>
                  <TableHead className="w-[11%]">Classificação</TableHead>
                  <TableHead className="w-[8%]"><TituloComFormula alinhar="left" titulo="Competência" formula={<span>Mês em que o valor conta: a competência do lançamento ou, na base “Data de pagamento”, o mês do pagamento. Segue a base escolhida no topo da tela.</span>} /></TableHead>
                  <TableHead className="w-[12%] text-right">Valor (R$)</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {lista.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Nenhuma retirada no período e filtros.</TableCell></TableRow>}
                {lista.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="truncate">{dataBR(l.data?.slice(0, 10) ?? null)}</TableCell>
                    <TableCell className="truncate font-medium" title={l.socioNome}>{l.socioNome}</TableCell>
                    <TableCell className="truncate"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${COR_TIPO[l.tipo]}`}>{ROTULO_TIPO_LANCAMENTO[l.tipo]}</span></TableCell>
                    <TableCell className="truncate" title={l.descricao}>{l.descricao || "—"}</TableCell>
                    <TableCell className="truncate" title={l.origem}>{l.origem || "—"}</TableCell>
                    <TableCell className="truncate" title={l.classificacao}>{l.classificacao || "—"}</TableCell>
                    <TableCell className="truncate">{rotuloMes(l.mes)}</TableCell>
                    <TableCell className="truncate text-right">{fmtMoney(l.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span>Total de lançamentos: <strong>{lista.length}</strong></span>
            <span>Total das retiradas antecipadas: <strong className="text-orange-600">{fmtMoney(totalLista)}</strong></span>
          </div>
          <p className="text-[11px] text-muted-foreground">Despesa do sócio = contrato “ADMINISTRATIVO &lt;sócio&gt;”. Investimento e Obra adm entram pelo integrante do lançamento (o que não é de sócio fica fora desta lista).</p>
        </CardContent>
      </Card>
      <Card className="flex flex-col">
        <CardHeader className="pb-2"><CardTitle className="text-base">Resumo das Retiradas</CardTitle></CardHeader>
        <CardContent className="flex flex-1 flex-col space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-emerald-50 p-2 dark:bg-emerald-950/30"><p className="text-[11px] text-muted-foreground">Total retirado no período</p><p className="font-bold text-emerald-700">{fmtMoney(totalLista)}</p></div>
            <div className="rounded-md bg-sky-50 p-2 dark:bg-sky-950/30"><p className="text-[11px] text-muted-foreground">Qtde. de lançamentos</p><p className="font-bold text-sky-700">{lista.length}</p></div>
          </div>
          <p className="text-sm font-semibold">Retiradas por sócio</p>
          <ul className="space-y-1 text-xs">
            {resumo.map((r, i) => (
              <li key={r.socioId} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CORES[i % CORES.length] }} />
                <span className="flex-1">{r.nome}</span><span>{fmtMoney(r.valor)}</span><span className="w-14 text-right text-muted-foreground">{pct2(r.pct)}</span>
              </li>
            ))}
            {resumo.length === 0 && <li className="text-muted-foreground">Sem retiradas.</li>}
          </ul>
          {resumo.length > 0 && (
            <div className="min-h-[14rem] flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={resumo.map((r) => ({ nome: r.nome, valor: r.valor }))} dataKey="valor" nameKey="nome" innerRadius="58%" outerRadius="95%">
                    {resumo.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                  </Pie>
                  <ChartTooltip formatter={(v: number) => fmtMoney(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Aba 3: Histórico de Distribuições ───────────────────────────────────────────────────────────────────────────────────────────────
function AbaHistorico({ ano, entradas, resultados, mesesRealizados, fechadas, podeFechar, mesAtual }: {
  ano: number; entradas: string[]; resultados: Map<string, ResultadoMes>; mesesRealizados: Set<string>;
  fechadas: ReturnType<typeof useCompetenciasFechadas>["data"] extends infer T ? Exclude<T, undefined> : never; podeFechar: boolean; mesAtual: string;
}) {
  const fechar = useFecharCompetencia();
  const reabrir = useReabrirCompetencia();
  const [fechando, setFechando] = useState<string | null>(null);
  const [reabrindo, setReabrindo] = useState<string | null>(null);
  const [complementoMes, setComplementoMes] = useState<string | null>(null);

  const linhas = useMemo(() => entradas.filter((m) => mesesRealizados.has(m) || m <= mesAtual).map((m) => {
    const calc = resultados.get(m)!;
    const f = fechadas.get(m);
    return linhaDoHistorico(calc, f ? { status: "fechado", dataFechamento: f.dataFechamento, socios: f.socios, resultadoAntesRetiradas: f.resultadoAntesRetiradas, lucroDistribuir: f.lucroDistribuir } : undefined);
  }), [entradas, mesesRealizados, resultados, fechadas, mesAtual]);
  const totais = useMemo(() => ({
    resultado: linhas.reduce((s, l) => s + l.resultadoAntesRetiradas, 0), lucro: linhas.reduce((s, l) => s + l.lucroDistribuir, 0), retiradas: linhas.reduce((s, l) => s + l.retiradas, 0),
    pago: linhas.reduce((s, l) => s + l.complementoPago, 0), saldo: linhas.reduce((s, l) => s + l.saldoRemanescente, 0), fechadas: linhas.filter((l) => l.status === "fechado").length,
  }), [linhas]);
  const ultimo = linhas.filter((l) => l.dataFechamento).map((l) => l.dataFechamento as string).sort().at(-1) ?? null;

  async function confirmarFechar() {
    if (!fechando) return;
    const calc = resultados.get(fechando)!;
    const pend = pendenciasParaFechar(calc);
    if (pend.length > 0) { toast.error(pend[0]); return; }
    try {
      await fechar.mutateAsync({ mes: fechando, resultadoAntesRetiradas: calc.resultadoAntesRetiradas, consumoEmpresa: calc.consumoEmpresa.total, lucroDistribuir: calc.lucroDistribuir, socios: fotoDoFechamento(calc) });
      toast.success(`Competência ${rotuloMes(fechando)} fechada.`);
      setFechando(null);
    } catch (e) { toast.error((e as { message?: string })?.message || "Erro ao fechar a competência."); }
  }
  async function confirmarReabrir() {
    if (!reabrindo) return;
    try { await reabrir.mutateAsync(reabrindo); toast.success(`Competência ${rotuloMes(reabrindo)} reaberta.`); setReabrindo(null); }
    catch (e) { toast.error((e as { message?: string })?.message || "Erro ao reabrir."); }
  }

  const grafico = linhas.map((l) => ({ rotulo: mesCurto(l.mes), lucro: Math.max(l.lucroDistribuir, 0), pago: l.complementoPago }));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2"><CardTitle className="text-base">Histórico de Distribuições — {ano}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Competência</TableHead>
                <TableHead className={CAB}><TituloComFormula titulo="Resultado do Período (R$)" formula={<span>Resultado após Outras Receitas − Tributos do mês (Fechamento da Empresa), antes das retiradas e do consumo da Empresa.</span>} /></TableHead>
                <TableHead className={CAB}><TituloComFormula titulo="Lucro a Distribuir (R$)" formula={<span>Resultado do Período − o que a Empresa consumiu em Investimentos e Obras Adm. Mês fechado: o valor gravado no fechamento.</span>} /></TableHead>
                <TableHead className={CAB}><TituloComFormula titulo="Retiradas Antecipadas (R$)" formula={<span>Soma, dos sócios, da coluna do Fechamento da Empresa + Investimentos e Obras Adm por integrante.</span>} /></TableHead>
                <TableHead className={CAB}><TituloComFormula titulo="Complemento Pago (R$)" formula={<span>O que já foi pago aos sócios do saldo a retirar do mês. Registrado por quem fecha, em “Complemento” (só mês fechado).</span>} /></TableHead>
                <TableHead className={CAB}><TituloComFormula titulo="Saldo Remanescente (R$)" formula={<span><strong>Saldo a retirar − Complemento pago.</strong> O que ainda pode ser retirado do mês.</span>} /></TableHead>
                <TableHead className={CAB}>Data do Fechamento</TableHead>
                <TableHead>Status</TableHead>
                {podeFechar && <TableHead className="print:hidden" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">Nenhuma competência realizada neste ano.</TableCell></TableRow>}
              {linhas.map((l) => (
                <TableRow key={l.mes}>
                  <TableCell className="whitespace-nowrap font-medium">{mesCurto(l.mes)}</TableCell>
                  <TableCell className={CEL}>{fmtMoney(l.resultadoAntesRetiradas)}</TableCell>
                  <TableCell className={CEL}>{fmtMoney(l.lucroDistribuir)}</TableCell>
                  <TableCell className={CEL}>{fmtMoney(l.retiradas)}</TableCell>
                  <TableCell className={`${CEL} text-emerald-700`}>{fmtMoney(l.complementoPago)}</TableCell>
                  <TableCell className={`${CEL} ${l.saldoRemanescente < 0 ? "text-red-600" : ""}`}>{fmtMoney(l.saldoRemanescente)}</TableCell>
                  <TableCell className={CEL}>{dataBR(l.dataFechamento)}</TableCell>
                  <TableCell>{l.status === "fechado"
                    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800"><Lock className="h-3 w-3" />Fechado</span>
                    : <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"><LockOpen className="h-3 w-3" />Aberto</span>}</TableCell>
                  {podeFechar && (
                    <TableCell className="whitespace-nowrap print:hidden">
                      {l.status === "aberto"
                        ? <Button size="sm" variant="outline" className="h-7" onClick={() => setFechando(l.mes)}>Fechar</Button>
                        : <span className="flex gap-1"><Button size="sm" variant="outline" className="h-7" onClick={() => setComplementoMes(l.mes)}>Complemento</Button><Button size="sm" variant="ghost" className="h-7" onClick={() => setReabrindo(l.mes)}>Reabrir</Button></span>}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
            {linhas.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className={`${CEL} font-semibold`}>{fmtMoney(totais.resultado)}</TableCell>
                  <TableCell className={`${CEL} font-semibold`}>{fmtMoney(totais.lucro)}</TableCell>
                  <TableCell className={`${CEL} font-semibold`}>{fmtMoney(totais.retiradas)}</TableCell>
                  <TableCell className={`${CEL} font-semibold`}>{fmtMoney(totais.pago)}</TableCell>
                  <TableCell className={`${CEL} font-semibold`}>{fmtMoney(totais.saldo)}</TableCell>
                  <TableCell colSpan={podeFechar ? 3 : 2} className="text-xs text-muted-foreground">{linhas.length} competências</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Mês aberto mostra o cálculo de hoje; mês fechado vale o que foi gravado. Saldo remanescente = saldo a retirar − complemento pago. Fechar e registrar o complemento exige a ação “fechar competência”.
          </p>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Evolução das Distribuições</CardTitle></CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grafico}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={mil} tick={{ fontSize: 10 }} width={40} />
                <ChartTooltip formatter={(v: number) => fmtMoney(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="lucro" name="Lucro a Distribuir" fill="#2563eb" radius={[3, 3, 0, 0]} />
                <Bar dataKey="pago" name="Complemento Pago" fill="#16a34a" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 p-4 text-sm">
            <div className="flex justify-between"><span>Competências fechadas</span><strong>{totais.fechadas} de {linhas.length}</strong></div>
            <div className="flex justify-between"><span>Total distribuído no ano</span><strong className="text-emerald-700">{fmtMoney(totais.lucro)}</strong></div>
            <div className="flex justify-between"><span>Total antecipado no ano</span><strong className="text-orange-600">{fmtMoney(totais.retiradas)}</strong></div>
            <div className="flex justify-between"><span>Último fechamento</span><strong>{dataBR(ultimo)}</strong></div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!fechando} onOpenChange={(o) => !o && setFechando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fechar {fechando ? rotuloMes(fechando) : ""}?</DialogTitle>
            <DialogDescription>
              Grava o lucro a distribuir, o percentual e as retiradas de cada sócio como estão hoje. Depois de fechado, o mês não muda quando o Fluxo de Caixa mudar; para mexer, é preciso reabrir.
            </DialogDescription>
          </DialogHeader>
          {fechando && pendenciasParaFechar(resultados.get(fechando)!).map((p) => <p key={p} className="text-sm text-amber-700">⚠ {p}</p>)}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFechando(null)}>Cancelar</Button>
            <Button onClick={confirmarFechar} disabled={fechar.isPending || (!!fechando && pendenciasParaFechar(resultados.get(fechando)!).length > 0)}>{fechar.isPending ? "Fechando..." : "Fechar competência"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reabrindo} onOpenChange={(o) => !o && setReabrindo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reabrir {reabrindo ? rotuloMes(reabrindo) : ""}?</DialogTitle>
            <DialogDescription>O mês volta a ser calculado com os dados de hoje e o complemento pago registrado nele é apagado.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReabrindo(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmarReabrir} disabled={reabrir.isPending}>{reabrir.isPending ? "Reabrindo..." : "Reabrir"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {complementoMes && fechadas.get(complementoMes) && <ComplementoDialog mes={complementoMes} fechamento={fechadas.get(complementoMes)!} onClose={() => setComplementoMes(null)} />}
    </div>
  );
}

function ComplementoDialog({ mes, fechamento, onClose }: { mes: string; fechamento: NonNullable<ReturnType<typeof useCompetenciasFechadas>["data"]> extends Map<string, infer V> ? V : never; onClose: () => void }) {
  const salvar = useSalvarComplementoPago();
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(fechamento.socios.map((s) => [s.socioId, String(s.complementoPago || "")])));
  async function gravar() {
    try {
      for (const s of fechamento.socios) {
        const v = Number(String(valores[s.socioId] ?? "").replace(",", ".")) || 0;
        if (v !== s.complementoPago) await salvar.mutateAsync({ mes, socioId: s.socioId, valor: v });
      }
      toast.success("Complemento pago salvo.");
      onClose();
    } catch (e) { toast.error((e as { message?: string })?.message || "Erro ao salvar o complemento."); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Complemento pago — {rotuloMes(mes)}</DialogTitle>
          <DialogDescription>Informe quanto de cada saldo a retirar já foi pago ao sócio. O saldo remanescente é o que falta.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {fechamento.socios.map((s) => (
            <div key={s.socioId} className="grid grid-cols-[1fr_auto_120px] items-center gap-2 text-sm">
              <span>{s.nome}</span>
              <span className="text-xs text-muted-foreground">saldo {fmtMoney(s.saldo)}</span>
              <Input className="h-8 text-right" inputMode="decimal" placeholder="0,00" value={valores[s.socioId] ?? ""} onChange={(e) => setValores((v) => ({ ...v, [s.socioId]: e.target.value }))} />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={gravar} disabled={salvar.isPending}>{salvar.isPending ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Percentual padrão dos sócios ────────────────────────────────────────────────────────────────────────────────────────────────────
// Os sócios (e o colaborador vinculado a cada um) já vêm cadastrados: aqui só se edita o PERCENTUAL PADRÃO. O de um mês específico se ajusta na aba Distribuição.
function ConfigSocios({ aberto, onClose, nomesDetectados, socios }: { aberto: boolean; onClose: () => void; nomesDetectados: string[]; socios: SocioConfig[] }) {
  const salvar = useSalvarSocios();
  const [percentuais, setPercentuais] = useState<Record<string, string>>(() => Object.fromEntries(socios.map((s) => [s.id, String(s.percentualPadrao)])));
  const valor = (s: SocioConfig) => Number(String(percentuais[s.id] ?? s.percentualPadrao).replace(",", ".")) || 0;
  const ativos = socios.filter((s) => s.ativo);
  const soma = Math.round(ativos.reduce((t, s) => t + valor(s), 0) * 100) / 100;
  const semCadastro = nomesDetectados.filter((n) => !socios.some((s) => s.nome.toLowerCase() === n.toLowerCase()));

  async function gravar() {
    try {
      await salvar.mutateAsync(socios.map((s) => ({ id: s.id, nome: s.nome, empregadoIds: s.empregadoIds, percentualPadrao: valor(s), ativo: s.ativo })));
      toast.success("Percentuais salvos.");
      onClose();
    } catch (e) { toast.error((e as { message?: string })?.message || "Erro ao salvar os percentuais."); }
  }
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sócios e percentuais</DialogTitle>
          <DialogDescription>
            Defina o percentual padrão de cada sócio; vale para todos os meses. Para um mês específico, ajuste na aba Distribuição. O colaborador de cada sócio já está vinculado
            (é quem vale como o sócio no <strong>integrante</strong> de Investimentos e Obras Adm).
          </DialogDescription>
        </DialogHeader>
        {socios.length === 0 && <p className="text-sm text-muted-foreground">Nenhum sócio cadastrado.</p>}
        <div className="space-y-2">
          {socios.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <div className="min-w-[220px] flex-1">
                <p className="text-sm font-semibold">{s.nome}</p>
                <p className="text-[11px] text-muted-foreground">Colaborador vinculado ({s.empregadoIds.length} cadastro{s.empregadoIds.length === 1 ? "" : "s"}): {s.empregadoIds.join(", ") || "nenhum"}</p>
              </div>
              <span className="flex items-center gap-1 text-xs">Percentual padrão
                <Input className="h-8 w-24 text-right" inputMode="decimal" disabled={!s.ativo} value={percentuais[s.id] ?? String(s.percentualPadrao)} onChange={(e) => setPercentuais((p) => ({ ...p, [s.id]: e.target.value }))} />%
              </span>
            </div>
          ))}
        </div>
        {semCadastro.length > 0 && <p className="text-xs text-amber-600">Há coluna de sócio no Fechamento da Empresa sem cadastro aqui: {semCadastro.join(", ")}. Peça ao time de sistemas para cadastrá-lo.</p>}
        <p className={`text-xs ${Math.abs(soma - 100) > 0.005 ? "text-amber-600" : "text-emerald-700"}`}>Soma dos percentuais: {pct2(soma)}{Math.abs(soma - 100) > 0.005 ? " — precisa fechar 100% para fechar uma competência." : ""}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={gravar} disabled={salvar.isPending || socios.length === 0}>{salvar.isPending ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
