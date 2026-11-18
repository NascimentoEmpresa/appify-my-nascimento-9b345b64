import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { Banknote, Briefcase, CheckCircle2, Clock, Download, FileText, Landmark, PiggyBank, Printer, Search, Target, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { useContratosAtivos, useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { useContratosERP } from "@/hooks/useContratosERP";
import { useItensNfEmissaoEmLote, useNfsEmissao } from "@/hooks/useNfEmissao";
import { useContasGarantidas, useMovimentosContaGarantida } from "@/hooks/useContaGarantida";
import { useAplicacoesFinanceiras, useHistoricoImportadoAplicacao, useResgatesCaixa } from "@/hooks/useAplicacaoFinanceira";
import { useFluxoCaixaGerencial } from "@/hooks/useFluxoCaixaGerencial";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import {
  composicaoTop, conciliacaoMalote, emprestimosPorMes, FLUXO_VAZIO, indicadores, kpisAplicacoesGerencial, kpisEmprestimos, kpisNotas, linhasDetalheNotas, necessidadeDeCaixa,
  notasDoPeriodo, notasRecebidasNoPeriodo, periodoDoMes, saldoProjetado, serieEntradasSaidas, serieNotas, type FiltroGerencial, type TipoDataGerencial,
} from "./fluxo-caixa-gerencial/regras";
import { DetalheIndicadorDialog, type IndicadorGerencial } from "./fluxo-caixa-gerencial/DetalheIndicadorDialog";
import { AssinaturaRegra } from "@/pages/malote/AssinaturaRegra";
import { PendentesPanel } from "./fluxo-caixa-gerencial/PendentesPanel";
import { DespesasPanel } from "./fluxo-caixa-gerencial/DespesasPanel";
import { ANALISE_VAZIA } from "./fluxo-caixa-gerencial/analiseDespesas";
import { EmprestimosAplicacoesPanel } from "./fluxo-caixa-gerencial/EmprestimosAplicacoesPanel";
import { detalheAplicacoes, emprestimosPorInstituicao, fluxoPorNatureza } from "./fluxo-caixa-gerencial/emprestimosAplicacoes";
import { AnaliseGerencialPanel } from "./fluxo-caixa-gerencial/AnaliseGerencialPanel";
import { analiseMensal, resumoGerencial } from "./fluxo-caixa-gerencial/analiseGerencial";
import { montarPlanilhasGerencial } from "./fluxo-caixa-gerencial/exportarGerencial";
import { useAnaliseDespesasGerencial } from "@/hooks/useAnaliseDespesasGerencial";
import { baixarExcel } from "@/pages/financeiro/conciliacao-servicos/exportarExcel";
import { useCartaoBancos } from "@/hooks/useMaloteCartaoCredito";
import { carteiraPendente, type ContratoParaPendentes } from "./fluxo-caixa-gerencial/pendentes";
import { vencimentoDaNota } from "./fluxo-caixa-gerencial/vencimento";
import { naoContabilizaKpi } from "@/pages/financeiro/nf-emissao/shared";

// SIS-2026-0871: Fluxo de Caixa Gerencial (pedido do Ruan, Financeiro; mockup dele). Só leitura. Veja regras.ts para a origem de cada número.
export const MENU_FLUXO_GERENCIAL = "fluxo-caixa-gerencial";

const CORES_PIZZA = ["#2563eb", "#f59e0b", "#16a34a", "#9333ea", "#e11d48", "#64748b"];
const mesCurto = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;
const milhoes = (v: number) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M` : Math.abs(v) >= 1_000 ? `${Math.round(v / 1_000)}k` : String(Math.round(v)));
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

function Anel({ valor, rotulo, detalhe }: { valor: number; rotulo: string; detalhe: string }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const preenchido = Math.min(Math.max(valor, 0), 1) * c;
  return (
    <div className="flex flex-1 flex-col items-center gap-1 text-center">
      <div className="relative h-20 w-20">
        <svg viewBox="0 0 70 70" className="h-20 w-20 -rotate-90">
          <circle cx="35" cy="35" r={r} fill="none" strokeWidth="7" className="stroke-muted" />
          <circle cx="35" cy="35" r={r} fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${preenchido} ${c}`} className="stroke-emerald-500" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold">{pct(valor)}</span>
      </div>
      <p className="text-xs font-semibold leading-tight">{rotulo}</p>
      <p className="text-[11px] leading-tight text-muted-foreground">{detalhe}</p>
    </div>
  );
}

export default function FluxoCaixaGerencial() {
  const inicial = periodoDoMes();
  const [rascunho, setRascunho] = useState<FiltroGerencial>({ ...inicial, empresaId: "", contratoId: "", tipoData: "emissao" });
  const [filtro, setFiltro] = useState<FiltroGerencial>({ ...inicial, empresaId: "", contratoId: "", tipoData: "emissao" });
  // SIS-2026-XXXX (etapa 1): indicador cujo detalhamento está aberto.
  const [detalhe, setDetalhe] = useState<IndicadorGerencial | null>(null);

  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();
  const contratosDaEmpresa = useMemo(() => contratos.filter((c) => !rascunho.empresaId || c.empresa_id === rascunho.empresaId), [contratos, rascunho.empresaId]);

  const { data: nfs = [], isLoading: carregandoNfs } = useNfsEmissao(null, { todasEmpresas: true });
  // Etapa 3: prazo de pagamento e cliente de cada contrato (vencimento calculado e aging dos pendentes).
  const { data: contratosERP = [] } = useContratosERP({ todasEmpresas: true });
  const contratosPendentes = useMemo(
    () => new Map<string, ContratoParaPendentes>(contratosERP.map((c) => [c.id, { nome: c.nome, cliente: c.cliente, prazoPagamento: c.prazo_pagamento }])),
    [contratosERP],
  );
  const filtroNotas = useMemo<FiltroGerencial>(
    () => ({ ...filtro, resolverVencimento: (n) => vencimentoDaNota(n, contratosPendentes.get(n.contrato_id)?.prazoPagamento)?.data ?? null }),
    [filtro, contratosPendentes],
  );
  const notas = useMemo(() => notasDoPeriodo(nfs, filtroNotas), [nfs, filtroNotas]);
  const { data: itensPorNf } = useItensNfEmissaoEmLote(notas.map((n) => n.id));
  // SIS-2026-XXXX: o recebido é o que ENTROU no período (data de pagamento), independente de quando a nota foi emitida; o resto segue o recorte de faturamento.
  const recebidas = useMemo(() => notasRecebidasNoPeriodo(nfs, filtro), [nfs, filtro]);
  const kNotas = useMemo(() => kpisNotas(notas, itensPorNf, recebidas), [notas, itensPorNf, recebidas]);
  const detalheNotas = useMemo(() => linhasDetalheNotas(notas, itensPorNf), [notas, itensPorNf]);
  const detalheRecebidas = useMemo(() => linhasDetalheNotas(recebidas, undefined), [recebidas]);
  const nomeEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nome ?? "—";
  const nomeContrato = (id: string) => contratos.find((c) => c.id === id)?.nome ?? "—";
  const serieNf = useMemo(() => serieNotas(nfs, filtroNotas), [nfs, filtroNotas]);
  const hojeIso = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }, []);
  const carteira = useMemo(
    () => carteiraPendente(nfs, itensPorNf, contratosPendentes, { empresaId: filtro.empresaId, contratoId: filtro.contratoId }, hojeIso),
    [nfs, itensPorNf, contratosPendentes, filtro.empresaId, filtro.contratoId, hojeIso],
  );
  const idsDoRecorte = useMemo(() => new Set(notas.filter((n) => !naoContabilizaKpi(n)).map((n) => n.id)), [notas]);

  const { data: contas = [] } = useContasGarantidas();
  const { data: movimentos = [] } = useMovimentosContaGarantida();
  const kEmprestimos = useMemo(() => kpisEmprestimos(contas, movimentos, filtro.empresaId), [contas, movimentos, filtro.empresaId]);
  const emprestimosMes = useMemo(() => emprestimosPorMes(contas, movimentos, filtro.empresaId, filtro.fim), [contas, movimentos, filtro.empresaId, filtro.fim]);

  const { data: aplicacoes = [] } = useAplicacoesFinanceiras();
  const { data: resgates = [] } = useResgatesCaixa();
  const { data: historico = [] } = useHistoricoImportadoAplicacao();
  const kAplicacoes = useMemo(() => kpisAplicacoesGerencial(aplicacoes, resgates, historico, filtro), [aplicacoes, resgates, historico, filtro]);

  const { data: fluxoRpc, isLoading: carregandoFluxo, error: erroFluxo } = useFluxoCaixaGerencial(filtro);
  const fluxo = fluxoRpc ?? FLUXO_VAZIO;

  const ind = useMemo(() => indicadores(kNotas, fluxo.despesas_pagas, kEmprestimos), [kNotas, fluxo.despesas_pagas, kEmprestimos]);
  const necessidade = useMemo(() => necessidadeDeCaixa(fluxo.despesas_pagas, filtro.ini, filtro.fim, fluxo.projecao.d30.recebimentos), [fluxo, filtro]);
  const composicao = useMemo(() => composicaoTop(fluxo.composicao, 5), [fluxo.composicao]);
  const serieCaixa = useMemo(() => serieEntradasSaidas(serieNf, emprestimosMes, fluxo.por_mes), [serieNf, emprestimosMes, fluxo.por_mes]);
  // Etapa 4: nome da instituição e o fluxo separado por natureza (operacional × empréstimos × aplicações), mês a mês.
  const { data: bancosCatalogo = [] } = useCartaoBancos();
  const nomeBanco = useMemo(() => { const m = new Map(bancosCatalogo.map((b) => [b.id, b.nome])); return (id: string) => m.get(id) ?? "—"; }, [bancosCatalogo]);
  const natureza = useMemo(
    () => fluxoPorNatureza({
      meses: serieNf.map((p) => p.mes), recebidoPorMes: new Map(serieNf.map((p) => [p.mes, p.recebido])), despesasPorMes: new Map(fluxo.por_mes.map((d) => [d.mes, d.despesas])),
      contas, movimentos, aplicacoes, resgates, historico, empresaId: filtro.empresaId,
    }),
    [serieNf, fluxo.por_mes, contas, movimentos, aplicacoes, resgates, historico, filtro.empresaId],
  );
  const analise = useMemo(() => analiseMensal(natureza, new Map(serieNf.map((p) => [p.mes, p.liquido]))), [natureza, serieNf]);
  const { data: despesasAnalise } = useAnaliseDespesasGerencial(filtro, "pagamento");

  // Exportação completa: um arquivo com os demonstrativos e os detalhamentos de onde vêm os números.
  async function exportarTudo() {
    const periodo = { ini: filtro.ini, fim: filtro.fim, empresaId: filtro.empresaId };
    await baixarExcel(
      montarPlanilhasGerencial({
        geradoEm: new Date(), filtro: filtroNotas, rotuloEmpresa: filtro.empresaId ? nomeEmpresa(filtro.empresaId) : "Todas", kpis: kNotas, despesasPagas: fluxo.despesas_pagas, malotePago: fluxo.malote_pago,
        analiseMensal: analise, resumo: resumoGerencial(analise), notasDoRecorte: detalheNotas, notasRecebidas: detalheRecebidas, pendentes: carteira,
        despesas: despesasAnalise ?? ANALISE_VAZIA, emprestimos: emprestimosPorInstituicao(contas, movimentos, nomeBanco, periodo, hojeIso).contas,
        aplicacoes: detalheAplicacoes(aplicacoes, periodo, hojeIso).linhas, natureza, empresaNome: nomeEmpresa, contratoNome: nomeContrato,
      }),
      `fluxo-caixa-gerencial-${filtro.ini}-a-${filtro.fim}.xlsx`,
    );
  }
  const concMalote = conciliacaoMalote(fluxo.despesas_pagas, fluxo.malote_pago);
  const pctMalote = concMalote.pctMalote;

  const carregando = carregandoNfs || carregandoFluxo;
  const periodoInvalido = !rascunho.ini || !rascunho.fim || rascunho.ini > rascunho.fim;

  function limpar() {
    const base: FiltroGerencial = { ...periodoDoMes(), empresaId: "", contratoId: "", tipoData: "emissao" };
    setRascunho(base);
    setFiltro(base);
  }

  return (
    <AcessoGate menu={MENU_FLUXO_GERENCIAL} acao="visualizar" fallback={<div className="p-6 text-sm text-muted-foreground">Sem acesso a esta tela.</div>}>
      <div className="space-y-5">
        <PageHeader
          module="Financeiro"
          breadcrumb={["Gestão Financeira", "Fluxo de Caixa Gerencial"]}
          title="Fluxo de Caixa Gerencial"
          subtitle="Controle de faturamento, recebimentos, despesas, empréstimos, aplicações financeiras, malote e projeções."
          actions={<div className="flex items-center gap-2"><Button variant="outline" onClick={() => void exportarTudo()}><Download className="mr-2 h-4 w-4" /> Exportar tudo (Excel)</Button><Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Imprimir</Button></div>}
        />

        {/* Filtros */}
        <Card className="print:hidden">
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div>
              <Label className="text-xs">De</Label>
              <Input type="date" value={rascunho.ini} onChange={(e) => setRascunho((f) => ({ ...f, ini: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Até</Label>
              <Input type="date" value={rascunho.fim} onChange={(e) => setRascunho((f) => ({ ...f, fim: e.target.value }))} />
            </div>
            <div className="min-w-[200px]">
              <Label className="text-xs">Faturamento por</Label>
              <Select value={rascunho.tipoData ?? "emissao"} onValueChange={(v) => setRascunho((f) => ({ ...f, tipoData: v as TipoDataGerencial }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="emissao">Data de emissão</SelectItem>
                  <SelectItem value="competencia">Competência</SelectItem>
                  <SelectItem value="vencimento">Vencimento (calculado)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[180px]">
              <Label className="text-xs">Empresa</Label>
              <Select value={rascunho.empresaId || "__todas"} onValueChange={(v) => setRascunho((f) => ({ ...f, empresaId: v === "__todas" ? "" : v, contratoId: "" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__todas">Todas</SelectItem>
                  {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[220px]">
              <Label className="text-xs">Contrato / Centro de custo</Label>
              <Select value={rascunho.contratoId || "__todos"} onValueChange={(v) => setRascunho((f) => ({ ...f, contratoId: v === "__todos" ? "" : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__todos">Todos</SelectItem>
                  {contratosDaEmpresa.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={periodoInvalido} onClick={() => setFiltro(rascunho)}><Search className="mr-2 h-4 w-4" /> Filtrar</Button>
            <Button variant="outline" onClick={limpar}>Limpar</Button>
            <p className="basis-full text-[11px] text-muted-foreground">
              Faturamento (bruto, líquido e pendente) = notas pela data escolhida em “Faturamento por”. Recebido = o que entrou no período, pela data de pagamento da nota. Despesas = pagas no período. Contrato/Centro de custo vale para notas, despesas e projeção; empréstimos e aplicações seguem só a Empresa. Clique num indicador para ver de onde vem o número.
            </p>
          </CardContent>
        </Card>

        {erroFluxo && (
          <Card className="border-destructive/40"><CardContent className="p-4 text-sm text-destructive">
            Não foi possível carregar os totais do Fluxo de Caixa: {(erroFluxo as { message?: string })?.message ?? "erro desconhecido"}
          </CardContent></Card>
        )}
        {carregando && <p className="text-sm text-muted-foreground">Carregando...</p>}

        {/* Notas e caixa */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <KpiTile label="Valor Bruto Já Emitido" valor={fmtMoney(kNotas.bruto)} sub={`${kNotas.qtd.toLocaleString("pt-BR")} nota(s) no período`} icon={<FileText />} cor="sky" onClick={() => setDetalhe("bruto")}
            info={<span>Soma do valor bruto das notas do recorte (emissão ou competência, conforme “Faturamento por”). Clique para ver as notas.<AssinaturaRegra chamado="SIS-2026-XXXX" /></span>} />
          <KpiTile label="Valor Líquido Faturado" valor={fmtMoney(kNotas.liquido)} sub="Bruto menos as retenções" icon={<Banknote />} cor="slate" onClick={() => setDetalhe("liquido")}
            info={<span>Bruto menos as retenções, nas mesmas notas do Valor Bruto. Clique para ver as notas.<AssinaturaRegra chamado="SIS-2026-XXXX" /></span>} />
          <KpiTile label="Valor Efetivamente Recebido" valor={fmtMoney(kNotas.recebido)} sub={`${recebidas.length.toLocaleString("pt-BR")} nota(s) com pagamento no período`} icon={<CheckCircle2 />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" onClick={() => setDetalhe("recebido")}
            info={<span>Soma do valor pago das notas com <strong>data de pagamento dentro do período</strong>, qualquer que seja a emissão ou a competência. Antes só somava o pago das notas emitidas no período, e por isso podia aparecer zerado. Clique para ver as notas.<AssinaturaRegra chamado="SIS-2026-XXXX" /></span>} />
          <KpiTile label="Despesas Pagas" valor={fmtMoney(fluxo.despesas_pagas)} sub={`${fluxo.qtd_despesas.toLocaleString("pt-BR")} lançamento(s) no período`} icon={<TrendingDown />} cor="red" valorClass="text-red-600 dark:text-red-400" onClick={() => setDetalhe("despesas")}
            info={<span>Saídas já pagas no Fluxo de Caixa. Não entram: transferência entre contas, aplicações, cheque especial, empréstimos, saldo anterior e recebimento de nota. Clique para ver a composição e a conciliação com o Malote.<AssinaturaRegra chamado="SIS-2026-XXXX" /></span>} />
          <KpiTile label="Valor Pendente de Recebimento" valor={fmtMoney(kNotas.pendente)} sub={`${pct(kNotas.pctPendenteDoLiquido)} do valor líquido`} icon={<Clock />} cor="amber" valorClass="text-amber-600 dark:text-amber-400" onClick={() => setDetalhe("pendente")}
            info={<span>Por nota: líquido − pago − desconto de conta vinculada − descontos pós-emissão (regra do Relatório de Serviços), nas notas do recorte de faturamento. Clique para ver as notas.<AssinaturaRegra chamado="SIS-2026-XXXX" /></span>} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <KpiTile label="Total de Empréstimos (contratado)" valor={fmtMoney(kEmprestimos.contratado)} sub="Limite das contas garantidas ativas" icon={<Landmark />} cor="sky" />
          <KpiTile label="Saldo Devedor (a bancos)" valor={fmtMoney(kEmprestimos.saldoDevedor)} sub="Resgates menos amortizações" icon={<Wallet />} cor="sky" />
          <KpiTile label="Despesas Pagas no Malote" valor={fmtMoney(fluxo.malote_pago)} sub={`${pct(pctMalote)} das despesas do período${concMalote.ok ? "" : " — conferir duplicidade"}`} icon={<Briefcase />} cor="sky" onClick={() => setDetalhe("malote")}
            info={<span>Parte das despesas pagas que veio do Malote. Já está <strong>dentro</strong> do total de Despesas Pagas, nunca é somada de novo; o detalhe mostra a conciliação (Malote + demais origens = total).<AssinaturaRegra chamado="SIS-2026-XXXX" /></span>} />
          <KpiTile label="Valor Projetado (30 dias)" valor={fmtMoney(saldoProjetado(fluxo.projecao.d30))} sub="Recebimentos − pagamentos previstos" icon={<Target />} cor="emerald" />
          <KpiTile label="Aplicações Financeiras (saldo atual)" valor={fmtMoney(kAplicacoes.saldoAtual)} sub="Principal + rendimento" icon={<PiggyBank />} cor="sky" />
        </div>

        {/* Gráficos */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Faturamento Mensal (R$)</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serieNf.map((p) => ({ ...p, rotulo: mesCurto(p.mes) }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={milhoes} tick={{ fontSize: 10 }} width={42} />
                  <ChartTooltip formatter={(v: number) => fmtMoney(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="bruto" name="Valor Bruto" fill="#1e3a8a" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="liquido" name="Valor Líquido" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Fluxo de Caixa <span className="text-xs font-normal text-muted-foreground">(Entradas × Saídas)</span></CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={serieCaixa.map((p) => ({ ...p, rotulo: mesCurto(p.mes) }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={milhoes} tick={{ fontSize: 10 }} width={42} />
                  <ChartTooltip formatter={(v: number) => fmtMoney(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="entradas" name="Entradas (recebimentos + empréstimos)" stroke="#2563eb" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="saidas" name="Saídas (despesas)" stroke="#f97316" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Composição das Despesas Pagas</CardTitle></CardHeader>
            <CardContent className="h-64">
              {composicao.length === 0 ? (
                <p className="pt-8 text-center text-sm text-muted-foreground">Sem despesas pagas no período.</p>
              ) : (
                <div className="flex h-full items-center gap-2">
                  <div className="relative h-full w-1/2">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={composicao} dataKey="valor" nameKey="nome" innerRadius="58%" outerRadius="90%" paddingAngle={1}>
                          {composicao.map((_, i) => <Cell key={i} fill={CORES_PIZZA[i % CORES_PIZZA.length]} />)}
                        </Pie>
                        <ChartTooltip formatter={(v: number) => fmtMoney(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="w-1/2 space-y-1 text-[11px]">
                    {composicao.map((c, i) => (
                      <li key={c.nome} className="flex items-start gap-1.5">
                        <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: CORES_PIZZA[i % CORES_PIZZA.length] }} />
                        <span className="flex-1 leading-tight">{c.nome}<br /><span className="text-muted-foreground">{fmtMoney(c.valor)} ({pct(c.pct)})</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Projeção, indicadores e aplicações */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Projeção de Fluxo de Caixa</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Período</TableHead>
                    <TableHead className="text-right">Recebimentos previstos</TableHead>
                    <TableHead className="text-right">Pagamentos previstos</TableHead>
                    <TableHead className="text-right">Saldo projetado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {([["d30", "Próximos 30 dias"], ["d60", "Próximos 60 dias"], ["d90", "Próximos 90 dias"]] as const).map(([k, rotulo]) => {
                    const p = fluxo.projecao[k];
                    const saldo = saldoProjetado(p);
                    return (
                      <TableRow key={k}>
                        <TableCell className="text-xs">{rotulo}</TableCell>
                        <TableCell className="text-right text-xs">{fmtMoney(p.recebimentos)}</TableCell>
                        <TableCell className="text-right text-xs">{fmtMoney(p.pagamentos)}</TableCell>
                        <TableCell className={`text-right text-xs font-semibold ${saldo < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmtMoney(saldo)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Pagamentos: compromissos em aberto (inclui vencidos) e lançamentos com data futura. Recebimentos: cronograma de faturamento e entradas previstas; o valor pendente das notas não tem data e fica no card ao lado.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Resumo e Indicadores</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Anel valor={ind.conversaoCaixa} rotulo="Conversão do Faturamento em Caixa" detalhe="(Recebido / Emitido)" />
                <Anel valor={ind.coberturaDespesas} rotulo="Cobertura das Despesas" detalhe="(Recebido / Despesas)" />
                <Anel valor={ind.dependenciaEmprestimos} rotulo="Dependência de Empréstimos" detalhe="(Saldo devedor / Despesas)" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Aplicações Financeiras</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-sky-50 p-2 dark:bg-sky-950/30">
                  <p className="text-[11px] text-muted-foreground">Saldo Atual</p>
                  <p className="text-base font-bold">{fmtMoney(kAplicacoes.saldoAtual)}</p>
                </div>
                <div className="rounded-md bg-emerald-50 p-2 dark:bg-emerald-950/30">
                  <p className="text-[11px] text-muted-foreground">Rendimentos no Período</p>
                  <p className="flex items-center gap-1 text-base font-bold text-emerald-600"><TrendingUp className="h-4 w-4" />{fmtMoney(kAplicacoes.rendimentoNoPeriodo)}</p>
                </div>
              </div>
              <Table>
                <TableBody>
                  <TableRow><TableCell className="py-1 text-xs">Aplicações</TableCell><TableCell className="py-1 text-right text-xs">{fmtMoney(kAplicacoes.aplicadoNoPeriodo)}</TableCell></TableRow>
                  <TableRow><TableCell className="py-1 text-xs">Resgates</TableCell><TableCell className="py-1 text-right text-xs text-red-600">{fmtMoney(kAplicacoes.resgatadoNoPeriodo)}</TableCell></TableRow>
                  <TableRow><TableCell className="py-1 text-xs">Rendimento</TableCell><TableCell className="py-1 text-right text-xs text-emerald-600">{fmtMoney(kAplicacoes.rendimentoNoPeriodo)}</TableCell></TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Análise das despesas (etapa 3) */}
        <DespesasPanel filtro={filtro} />

        {/* Recebimentos pendentes (aging) */}
        <PendentesPanel carteira={carteira} idsDoRecorte={idsDoRecorte} kpiPendente={kNotas.pendente} referencia={hojeIso} empresaNome={nomeEmpresa} />

        {/* Empréstimos e aplicações (etapa 4) */}
        <EmprestimosAplicacoesPanel contas={contas} movimentos={movimentos} aplicacoes={aplicacoes} nomeBanco={nomeBanco} filtro={{ ini: filtro.ini, fim: filtro.fim, empresaId: filtro.empresaId }} referencia={hojeIso} natureza={natureza} />

        {/* Análises gerenciais (etapa 4) */}
        <AnaliseGerencialPanel pontos={analise} />

        {/* Necessidade de caixa */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 p-4">
            <div className="flex min-w-[240px] flex-1 items-center gap-3">
              <Target className="h-10 w-10 shrink-0 text-orange-500" />
              <div>
                <p className="text-base font-bold">Necessidade de Caixa para Operação</p>
                <p className="text-xs text-muted-foreground">Quanto falta (ou sobra) para manter as operações: custo mensal das despesas menos os recebimentos previstos dos próximos 30 dias.</p>
              </div>
            </div>
            <div className="rounded-lg bg-sky-50 p-3 text-center dark:bg-sky-950/30">
              <p className="text-[11px] text-muted-foreground">Custo Operacional Mensal<br />(Despesas pagas ÷ meses do período)</p>
              <p className="text-lg font-bold">{fmtMoney(necessidade.custoMensal)}</p>
            </div>
            <span className="text-2xl font-bold text-muted-foreground">−</span>
            <div className="rounded-lg bg-emerald-50 p-3 text-center dark:bg-emerald-950/30">
              <p className="text-[11px] text-muted-foreground">Recebimentos Previstos<br />(próximos 30 dias)</p>
              <p className="text-lg font-bold text-emerald-600">{fmtMoney(necessidade.recebimentosPrevistos)}</p>
            </div>
            <span className="text-2xl font-bold text-muted-foreground">=</span>
            <div className={`rounded-lg p-3 text-center ${necessidade.necessidade > 0 ? "bg-red-50 dark:bg-red-950/30" : "bg-emerald-50 dark:bg-emerald-950/30"}`}>
              <p className="text-[11px] text-muted-foreground">{necessidade.necessidade > 0 ? "Necessidade de Caixa" : "Sobra de Caixa"}</p>
              <p className={`text-xl font-bold ${necessidade.necessidade > 0 ? "text-red-600" : "text-emerald-600"}`}>{fmtMoney(Math.abs(necessidade.necessidade))}</p>
            </div>
          </CardContent>
        </Card>
      </div>
      <DetalheIndicadorDialog
        indicador={detalhe}
        onClose={() => setDetalhe(null)}
        notas={detalheNotas}
        recebidas={detalheRecebidas}
        fluxo={fluxo}
        filtro={filtro}
        contratoNome={nomeContrato}
        empresaNome={nomeEmpresa}
      />
    </AcessoGate>
  );
}
