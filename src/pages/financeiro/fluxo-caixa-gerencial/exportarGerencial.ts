import type { Celula, Planilha } from "@/pages/financeiro/conciliacao-servicos/exportarExcel";
import type { AnaliseDespesasRpc } from "./analiseDespesas";
import type { PontoAnalise, ResumoGerencial } from "./analiseGerencial";
import type { LinhaAplicacao, LinhaEmprestimo, PontoNatureza } from "./emprestimosAplicacoes";
import type { LinhaPendente } from "./pendentes";
import type { FiltroGerencial, KpisNotas, LinhaDetalheNota } from "./regras";
import { ROTULO_FAIXA, ROTULO_ORIGEM_VENCIMENTO } from "./vencimento";

// SIS-2026-0893 (etapa 4) — Exportação completa do Fluxo de Caixa Gerencial: UM arquivo com os demonstrativos e os detalhamentos de onde vêm os números.
// `montarPlanilhasGerencial` é pura (testável); quem baixa é `baixarExcel`, de conciliacao-servicos/exportarExcel.

const dia = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR") : "—");
const mes = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const pct = (v: number | null): Celula => (v === null ? "—" : Math.round(v * 10000) / 100);

export interface DadosExportacaoGerencial {
  geradoEm: Date;
  filtro: FiltroGerencial;
  rotuloEmpresa: string;
  kpis: KpisNotas;
  despesasPagas: number;
  malotePago: number;
  analiseMensal: PontoAnalise[];
  resumo: ResumoGerencial;
  notasDoRecorte: LinhaDetalheNota[];
  notasRecebidas: LinhaDetalheNota[];
  pendentes: LinhaPendente[];
  despesas: AnaliseDespesasRpc;
  emprestimos: LinhaEmprestimo[];
  aplicacoes: LinhaAplicacao[];
  natureza: PontoNatureza[];
  empresaNome: (id: string) => string;
  contratoNome: (id: string) => string;
}

export function montarPlanilhasGerencial(d: DadosExportacaoGerencial): Planilha[] {
  const resumo: Planilha = {
    nome: "Resumo",
    linhas: [
      ["Fluxo de Caixa Gerencial"],
      ["Gerado em", d.geradoEm.toLocaleString("pt-BR")],
      ["Período", `${dia(d.filtro.ini)} a ${dia(d.filtro.fim)}`],
      ["Faturamento por", d.filtro.tipoData === "competencia" ? "Competência" : d.filtro.tipoData === "vencimento" ? "Vencimento (calculado)" : "Data de emissão"],
      ["Empresa", d.rotuloEmpresa],
      [],
      ["Valor bruto emitido", d.kpis.bruto], ["Valor líquido faturado", d.kpis.liquido], ["Valor efetivamente recebido (pela data de pagamento)", d.kpis.recebido], ["Valor pendente de recebimento", d.kpis.pendente],
      ["Despesas pagas", d.despesasPagas], ["Despesas pagas no Malote", d.malotePago],
      [],
      ["Cobertura das despesas (período)", pct(d.resumo.coberturaPeriodo)], ["Dependência de recursos bancários (período)", pct(d.resumo.dependenciaPeriodo)],
      ["Meses com déficit operacional", d.resumo.mesesComDeficit], ["Maior déficit mensal", d.resumo.maiorDeficit], ["Mês do maior déficit", d.resumo.mesDoMaiorDeficit ? mes(d.resumo.mesDoMaiorDeficit) : "—"],
      ["Saldo devedor de empréstimos (fim da série)", d.resumo.saldoDevedorFim],
    ],
  };

  const mensal: Planilha = {
    nome: "Análise mensal",
    linhas: [
      ["Mês", "Faturamento líquido", "Recebimentos", "Despesas pagas", "Resultado", "Necessidade de capital de giro", "Utilização líquida de crédito", "Saldo devedor (fim)", "Cobertura (%)", "Dependência bancária (%)", "Var. faturamento (%)", "Var. recebimentos (%)", "Var. despesas (%)"],
      ...d.analiseMensal.map((p): Celula[] => [mes(p.mes), p.faturamentoLiquido, p.recebimentos, p.despesas, p.resultado, p.necessidadeCapitalGiro, p.utilizacaoCapitalGiro, p.saldoDevedorFim, pct(p.cobertura), pct(p.dependenciaBancaria), pct(p.variacaoFaturamentoPct), pct(p.variacaoRecebimentosPct), pct(p.variacaoDespesasPct)]),
    ],
  };

  const cabNota: Celula[] = ["NF", "Empresa", "Contrato", "Competência", "Emissão", "Pagamento", "Bruto", "Líquido", "Pago", "Pendente"];
  const linhaNota = (l: LinhaDetalheNota): Celula[] => [l.numero, d.empresaNome(l.empresaId), d.contratoNome(l.contratoId), mes(l.competencia), dia(l.emissao), dia(l.pagamento), l.bruto, l.liquido, l.pago, l.pendente];

  const pendentes: Planilha = {
    nome: "Pendentes (aging)",
    linhas: [
      ["Cliente", "Contrato", "Empresa", "NF", "Competência", "Emissão", "Vencimento", "Origem do vencimento", "Dias de atraso", "Faixa", "Líquido", "Pago", "Conta vinculada", "Pós-emissão", "Pendente"],
      ...d.pendentes.map((l): Celula[] => [l.cliente, l.contrato, d.empresaNome(l.empresaId), l.numero, mes(l.competencia), dia(l.emissao), dia(l.vencimento), l.origemVencimento ? ROTULO_ORIGEM_VENCIMENTO[l.origemVencimento] : "—", l.atraso ?? "—", ROTULO_FAIXA[l.faixa], l.liquido, l.pago, l.contaVinculada, l.posEmissao, l.pendente]),
    ],
  };

  const cabDesp: Celula[] = ["Item", "Período atual", "Período anterior", "Variação (R$)"];
  const linhasDesp = (xs: { nome: string; valor: number; valor_anterior: number }[]): Celula[][] => xs.map((x) => [x.nome, x.valor, x.valor_anterior, Math.round((x.valor - x.valor_anterior) * 100) / 100]);

  return [
    resumo,
    mensal,
    { nome: "Notas do recorte", linhas: [cabNota, ...d.notasDoRecorte.map(linhaNota)] },
    { nome: "Notas recebidas no período", linhas: [cabNota, ...d.notasRecebidas.map(linhaNota)] },
    pendentes,
    { nome: "Despesas por classificação", linhas: [cabDesp, ...linhasDesp(d.despesas.por_classificacao)] },
    { nome: "Despesas por contrato", linhas: [cabDesp, ...linhasDesp(d.despesas.por_contrato)] },
    { nome: "Despesas por origem", linhas: [cabDesp, ...linhasDesp(d.despesas.por_origem)] },
    {
      nome: "Empréstimos",
      linhas: [["Instituição", "Conta", "Situação", "Limite", "Utilizado", "Disponível", "Vencimento", "Juros no período"], ...d.emprestimos.map((l): Celula[] => [l.instituicao, l.conta, l.status, l.limite, l.utilizado, l.disponivel, dia(l.vencimento), l.jurosNoPeriodo])],
    },
    {
      nome: "Aplicações",
      linhas: [["Instituição", "Nº", "Produto", "Aplicado", "Rendimento", "Saldo atual", "Vencimento"], ...d.aplicacoes.map((l): Celula[] => [l.instituicao, l.numero, l.produto, l.valorAplicado, l.rendimentoAcumulado, l.saldoAtual, dia(l.vencimento)])],
    },
    {
      nome: "Fluxo por natureza",
      linhas: [
        ["Mês", "Recebimentos operacionais", "Despesas operacionais", "Resultado operacional", "Empréstimo utilizado", "Empréstimo amortizado", "Juros pagos", "Saldo devedor (fim)", "Aplicado", "Resgatado das aplicações", "Rendimentos"],
        ...d.natureza.map((p): Celula[] => [mes(p.mes), p.recebimentosOperacionais, p.despesasOperacionais, p.resultadoOperacional, p.emprestimoUtilizado, p.emprestimoAmortizado, p.jurosPagos, p.saldoDevedorFim, p.aplicado, p.resgatadoAplicacoes, p.rendimentos]),
      ],
    },
  ];
}
