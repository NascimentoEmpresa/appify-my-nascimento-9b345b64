// SIS-2026-0553: regras puras do Painel de Auditoria da Controladoria.
// A Controladoria NÃO confere lançamento a lançamento: vê totais consolidados e
// aprova/rejeita. Aqui ficam o catálogo das 7 validações, o cálculo dos totais
// que não dependem de tela e as comparações — tudo testável.

export type TipoValidacao = "malote_fluxo" | "fluxo_extrato" | "centros_malote" | "orcado_realizado" | "faturado" | "recebido" | "descontos";
export type StatusValidacao = "pendente" | "aprovado" | "rejeitado";

export interface DefValidacao {
  tipo: TipoValidacao;
  numero: number;
  titulo: string;
  rotuloA: string;
  rotuloB: string;
  // "igual": os dois totais deveriam bater (diferença ≠ 0 é divergência).
  // "livre": os valores não precisam ser iguais (Orçado × Realizado, Faturado ×
  // falta faturar...) — a diferença é informativa e a Controladoria só valida.
  comparacao: "igual" | "livre";
  link: string;
  linkRotulo: string;
}

export const VALIDACOES: DefValidacao[] = [
  { tipo: "malote_fluxo", numero: 1, titulo: "Conciliação do Malote em relação ao Fluxo de Caixa", rotuloA: "Malote + Lançamentos do Financeiro", rotuloB: "Total no Fluxo de Caixa", comparacao: "igual", link: "/app/financeiro/gestao-financeira/fluxo-caixa", linkRotulo: "Fluxo de Caixa" },
  { tipo: "fluxo_extrato", numero: 2, titulo: "Conciliação do Fluxo de Caixa em relação ao Extrato", rotuloA: "Total no Fluxo de Caixa", rotuloB: "Total conciliado com extratos", comparacao: "igual", link: "/app/financeiro/gestao-financeira/conciliacao-fluxo-caixa", linkRotulo: "Conciliação Bancária" },
  { tipo: "centros_malote", numero: 3, titulo: "Conciliação de gastos dos Centros de Custo em relação ao Malote e lançamentos financeiros", rotuloA: "Saldo utilizável do Fluxo (saídas − aplicações − transferências)", rotuloB: "Total em Centros de Custo (contratos + administrativo + sócios)", comparacao: "igual", link: "/app/controladoria/centros-custo", linkRotulo: "Centros de Custo" },
  { tipo: "orcado_realizado", numero: 4, titulo: "Comparativo de Orçado × Realizado", rotuloA: "Total Orçado", rotuloB: "Total Realizado", comparacao: "livre", link: "/app/malote/orcamento-geral", linkRotulo: "Orçamento Geral" },
  { tipo: "faturado", numero: 5, titulo: "Totais de notas faturadas × falta faturar", rotuloA: "Total Faturado", rotuloB: "Falta Faturar", comparacao: "livre", link: "/app/financeiro/controle-faturamento", linkRotulo: "Controle de Faturamento" },
  { tipo: "recebido", numero: 6, titulo: "Totais de notas recebidas × falta receber", rotuloA: "Total Recebido", rotuloB: "Falta Receber", comparacao: "livre", link: "/app/financeiro/relatorio-servicos", linkRotulo: "Relatório de Serviços" },
  { tipo: "descontos", numero: 7, titulo: "Totais de descontos de contratos por categoria × valor total descontado", rotuloA: "Descontos por Categoria", rotuloB: "Valor Total Descontado", comparacao: "igual", link: "/app/financeiro/relatorio-servicos", linkRotulo: "Relatório de Serviços" },
];

export const STATUS_LABEL: Record<StatusValidacao, string> = {
  pendente: "Pendente de validação",
  aprovado: "Aprovado pela Controladoria",
  rejeitado: "Rejeitado pela Controladoria",
};

// Diferença abaixo disso (centavos de arredondamento) conta como "bateu".
export const TOLERANCIA = 1;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface LinhaMaloteFluxo { valor: number; empresa_id: string | null; contrato_id: string | null }

export interface TotaisCard {
  a: number;
  b: number;
  // Texto curto quando a fonte cobre só parte do que o chamado pede.
  aviso?: string;
  // Preenchido quando a fonte do dado NÃO existe no sistema: o card mostra o
  // motivo, não compara e não deixa aprovar (nada de número inventado).
  indisponivel?: string;
  // Linhas extras (ex.: descontos por categoria).
  detalhes?: { rotulo: string; valor: number; somaNoTotal?: boolean }[];
  // Painel específico dos cards 1 a 4 (SIS-2026-0657).
  painel?: PainelCard;
}

// SIS-2026-0657: cada um dos cards 1 a 4 ganhou um painel próprio (como nos mockups). O hook
// monta o painel; a tela só desenha.
export interface PainelMaloteFluxo {
  kind: "malote_fluxo";
  malote: number;
  financeiro: number;
  financeiroPorOrigem: { origem: string; valor: number }[];
  fluxoSaidas: number;
  // SIS-2026-0687: aplicação financeira entra no total (é uma das origens do Fluxo); aqui fica o valor dela à parte.
  aplicacoes: number;
  // Despesas do Malote cujo valor no Malote e no Fluxo não é o mesmo (relatório do card 1).
  divergencias: DivergenciaMalote[];
}

export type MotivoDivergencia = "ajustado_no_fluxo" | "so_no_malote" | "so_no_fluxo" | "valor_diferente";
export interface DivergenciaMalote {
  despesaId: string;
  numero: string | null;
  malote: number;
  fluxo: number;
  diferenca: number; // Malote − Fluxo
  motivo: MotivoDivergencia;
}
export interface EntradasSaidas { entradas: number; saidas: number; movimentado: number; saldo: number }
export interface PainelFluxoExtrato {
  kind: "fluxo_extrato";
  // Com conciliação salva: Fluxo só dos bancos/empresas conciliados (compara o mesmo recorte do extrato).
  // Sem nenhuma: Fluxo do mês inteiro (nada a comparar ainda).
  fluxo: EntradasSaidas;
  extrato: EntradasSaidas;
  difEntradas: number;
  difSaidas: number;
  conciliacoes: number;
  conciliado: boolean;
  // Fluxo do mês inteiro (todos os bancos) e quanto das saídas ele já está coberto por conciliação.
  fluxoMes: EntradasSaidas;
  cobertura: number | null;
  bancos: string[];
  // Conciliações salvas sem o total do extrato (anteriores à migration 20261014000006 e ainda sem carga).
  semTotais: number;
  // SIS-2026-0701: ponte do Fluxo de Caixa da tela (todas as linhas do mês, com o saldo anterior) até o recorte que se compara com o
  // extrato. total = saldoAnterior + semConciliacao + ignorados + recorte. Só existe quando há conciliação salva.
  ponte: PontePainelFluxo | null;
}
export interface PontePainelFluxo {
  total: EntradasSaidas;
  saldoAnterior: EntradasSaidas;
  semConciliacao: EntradasSaidas;
  ignorados: EntradasSaidas;
}
export interface CentroAcima { nome: string; excesso: number }
export interface PainelOrcadoRealizado {
  kind: "orcado_realizado";
  principais: CentroAcima[];
  outros: number;
  outrosQtd: number;
  totalAcima: number;
}
export interface LancamentoSemCentro {
  origem: string;
  despesaId: string | null;
  numero: string | null;
  descricao: string;
  classificacao: string | null;
  data: string | null;
  valor: number;
  motivo: "sem_classificacao" | "contrato_nao_informado";
}
export interface PainelCentros { kind: "centros"; pendentes: LancamentoSemCentro[] }

// SIS-2026-0720: item 3 parte da SAÍDA TOTAL do Fluxo de Caixa. O que não é despesa (aplicação financeira e transferência entre contas)
// sai; o que sobra é o saldo utilizável, que precisa estar distribuído nos centros de custo (contratos, administrativo e sócios). O que
// não está em nenhum centro é o "falta distribuir": a lista dos lançamentos leva ao Fluxo já na reclassificação.
export interface LancamentoFaltaDistribuir extends LancamentoSemCentro {
  numeroParcela: number | null;
  // Aprovadores N1/N2 da classificação do lançamento (o "gerente responsável"); vazio quando não há classificação.
  responsaveis: string[];
}
export interface PainelCentrosFluxo {
  kind: "centros_fluxo";
  saidaTotal: number;
  aplicacoes: number;
  transferencias: number;
  saldoUtilizavel: number;
  contratos: number;
  administrativo: number;
  socios: number;
  faltaDistribuir: number;
  lancamentos: LancamentoFaltaDistribuir[];
}
export type PainelCard = PainelMaloteFluxo | PainelFluxoExtrato | PainelOrcadoRealizado | PainelCentros | PainelCentrosFluxo;


export function diferenca(t: Pick<TotaisCard, "a" | "b">): { valor: number; percentual: number | null } {
  const valor = r2(t.a - t.b);
  return { valor, percentual: t.a !== 0 ? valor / t.a : null };
}

export type SituacaoComparacao = "confere" | "diverge" | "informativo";

export function situacaoComparacao(def: Pick<DefValidacao, "comparacao">, t: Pick<TotaisCard, "a" | "b"> & { painel?: PainelCard }): SituacaoComparacao {
  if (def.comparacao === "livre") return "informativo";
  // Fluxo × Extrato: entradas e saídas são conferidas separadas (somar as duas escondia divergência).
  if (t.painel?.kind === "fluxo_extrato") {
    return Math.abs(t.painel.difEntradas) <= TOLERANCIA && Math.abs(t.painel.difSaidas) <= TOLERANCIA ? "confere" : "diverge";
  }
  return Math.abs(t.a - t.b) <= TOLERANCIA ? "confere" : "diverge";
}

export interface ResumoStatus {
  aprovadas: number;
  pendentes: number;
  rejeitadas: number;
  total: number;
}

// Validação sem linha no banco é pendente. Sempre as 7, mesmo sem nenhuma decisão.
export function statusGeral(validacoes: { tipo: string; status: StatusValidacao }[]): ResumoStatus {
  const porTipo = new Map(validacoes.map((v) => [v.tipo, v.status]));
  let aprovadas = 0, rejeitadas = 0;
  for (const d of VALIDACOES) {
    const s = porTipo.get(d.tipo);
    if (s === "aprovado") aprovadas += 1;
    else if (s === "rejeitado") rejeitadas += 1;
  }
  return { aprovadas, rejeitadas, pendentes: VALIDACOES.length - aprovadas - rejeitadas, total: VALIDACOES.length };
}

// Aprovado, mas os totais de hoje já não são os que a Controladoria viu: o
// aceite perdeu o sentido e a tela avisa para validar de novo.
export function valoresMudaramDesdeDecisao(snapshot: { a?: number; b?: number } | null | undefined, atual: Pick<TotaisCard, "a" | "b">): boolean {
  if (!snapshot || typeof snapshot.a !== "number" || typeof snapshot.b !== "number") return false;
  return Math.abs(snapshot.a - atual.a) > TOLERANCIA || Math.abs(snapshot.b - atual.b) > TOLERANCIA;
}

export const periodoDeMes = (anoMes: string) => `${anoMes}-01`;

export function proximoMesData(anoMes: string): string {
  const [a, m] = anoMes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
}

// ── 1. Malote (fonte própria, sem passar pela view do Fluxo) ────────────────
export interface DespesaMalote {
  id: string;
  numero?: string | null;
  empresa_id: string | null;
  contrato_id: string | null;
  valor_aprovado: number | null;
  valor_total: number | null;
  parcelado: boolean;
}
export interface RateioMalote { despesa_id: string; empresa_id: string | null; contrato_id: string | null; valor: number }
export interface ParcelaPaga { despesa_id: string; valor: number }

export interface FiltroAuditoria {
  empresaId: string | null;
  contratoId: string | null;
}

function passaFiltro(f: FiltroAuditoria, empresaId: string | null, contratoId: string | null) {
  if (f.empresaId && empresaId !== f.empresaId) return false;
  if (f.contratoId && contratoId !== f.contratoId) return false;
  return true;
}

// Mesma regra de composição que o Fluxo usa para o Malote (rateio por linha;
// parcela proporcional ao rateio), mas lida direto das tabelas do Malote — é
// isso que permite comparar: o Fluxo ainda aplica os ajustes feitos só nele.
// `despesasNaoParceladas` = pagas no período; `parcelas` = parcelas pagas no período.
export function totalMaloteDireto(
  despesasNaoParceladas: DespesaMalote[],
  parcelas: ParcelaPaga[],
  despesasDasParcelas: DespesaMalote[],
  rateios: RateioMalote[],
  filtro: FiltroAuditoria
): number {
  const porDespesa = maloteDiretoPorDespesa(despesasNaoParceladas, parcelas, despesasDasParcelas, rateios, filtro);
  let total = 0;
  porDespesa.forEach((d) => { total += d.valor; });
  return r2(total);
}

// SIS-2026-0657: o mesmo cálculo, mas por despesa — é o que permite apontar QUAIS despesas divergem do Fluxo.
export function maloteDiretoPorDespesa(
  despesasNaoParceladas: DespesaMalote[],
  parcelas: ParcelaPaga[],
  despesasDasParcelas: DespesaMalote[],
  rateios: RateioMalote[],
  filtro: FiltroAuditoria
): Map<string, { valor: number; numero: string | null }> {
  const porDespesa = new Map<string, { valor: number; numero: string | null }>();
  const soma = (d: DespesaMalote, v: number) => {
    const atual = porDespesa.get(d.id) ?? { valor: 0, numero: d.numero ?? null };
    atual.valor += v;
    porDespesa.set(d.id, atual);
  };
  const rateioPorDespesa = new Map<string, RateioMalote[]>();
  for (const r of rateios) {
    const arr = rateioPorDespesa.get(r.despesa_id) ?? [];
    arr.push(r);
    rateioPorDespesa.set(r.despesa_id, arr);
  }
  for (const d of despesasNaoParceladas) {
    const linhas = rateioPorDespesa.get(d.id);
    if (linhas?.length) {
      for (const l of linhas) if (passaFiltro(filtro, l.empresa_id ?? d.empresa_id, l.contrato_id ?? d.contrato_id)) soma(d, Number(l.valor) || 0);
    } else if (passaFiltro(filtro, d.empresa_id, d.contrato_id)) {
      soma(d, Number(d.valor_aprovado) || 0);
    }
  }
  const porId = new Map(despesasDasParcelas.map((d) => [d.id, d]));
  for (const p of parcelas) {
    const d = porId.get(p.despesa_id);
    if (!d) continue;
    const linhas = rateioPorDespesa.get(d.id);
    if (linhas?.length) {
      for (const l of linhas) {
        if (!passaFiltro(filtro, l.empresa_id ?? d.empresa_id, l.contrato_id ?? d.contrato_id)) continue;
        const prop = d.valor_total ? (Number(l.valor) || 0) / Number(d.valor_total) : 1;
        soma(d, (Number(p.valor) || 0) * prop);
      }
    } else if (passaFiltro(filtro, d.empresa_id, d.contrato_id)) {
      soma(d, Number(p.valor) || 0);
    }
  }
  return porDespesa;
}

// ── 3. Centros de Custo × Malote ────────────────────────────────────────────
// O centro de custo operacional É o contrato (cada contrato é um centro) e o
// rateio do Malote já carrega o contrato; as classificações administrativas
// pertencem aos centros administrativos. Então todo gasto do Malote deveria cair
// em uma das duas. O que sobra é pendência real: classificação de CONTRATO
// lançada sem contrato (ou sem classificação) — não dá para atribuir a centro.
export interface LinhaCentroMalote {
  valor: number;
  empresa_id: string | null;
  contrato_id: string | null;
  classificacao_id: string | null;
  // Identificação do lançamento (só para o relatório dos "sem centro"; os totais não usam).
  origem?: string;
  despesa_id?: string | null;
  id_malote?: string | null;
  descricao?: string | null;
  classificacao_nome?: string | null;
  data_pagamento?: string | null;
}

export function totaisCentrosMalote(
  linhas: LinhaCentroMalote[],
  tipoPorClassificacao: Map<string, string | null>,
  filtro: FiltroAuditoria
): { total: number; comContrato: number; administrativo: number; pendente: number } {
  let total = 0, comContrato = 0, administrativo = 0;
  for (const l of linhas) {
    if (!passaFiltro(filtro, l.empresa_id, l.contrato_id)) continue;
    const v = Number(l.valor) || 0;
    total += v;
    if (l.contrato_id) comContrato += v;
    else if (l.classificacao_id && tipoPorClassificacao.get(l.classificacao_id) === "administrativo") administrativo += v;
  }
  return { total: r2(total), comContrato: r2(comContrato), administrativo: r2(administrativo), pendente: r2(total - comContrato - administrativo) };
}

// ── SIS-2026-0720: item 3 a partir da saída total do Fluxo de Caixa ──────────────────────────────────────
export type TipoCentro = "contrato" | "administrativo" | "socio";

// Transferência entre contas é movimento do dinheiro da própria empresa, não despesa (junto da aplicação financeira, fica fora do
// saldo utilizável). Casa pelo nome da classificação, sem acento e sem caixa.
export const ehTransferenciaEntreContas = (l: Pick<LinhaFluxoAud, "classificacao_nome">) =>
  semAcento((l.classificacao_nome ?? "").trim().toUpperCase()) === "TRANSFERENCIA ENTRE CONTAS";

export function totaisCentrosFluxo(
  fluxo: (LinhaFluxoAud & { numero_parcela?: number | null })[],
  tipoDoContrato: (contratoId: string) => TipoCentro,
  tipoPorClassificacao: Map<string, string | null>,
  responsaveisPorClassificacao: Map<string, string[]>,
  filtro: FiltroAuditoria,
): PainelCentrosFluxo {
  let saidaTotal = 0, aplicacoes = 0, transferencias = 0, contratos = 0, administrativo = 0, socios = 0;
  const por = new Map<string, LancamentoFaltaDistribuir>();
  fluxo.forEach((l, i) => {
    if (l.tipo !== "saida" || ehSaldoAnterior(l) || !passaLinha(filtro, l)) return;
    const v = Number(l.valor) || 0;
    saidaTotal += v;
    if (ehAplicacao(l)) { aplicacoes += v; return; }
    if (ehTransferenciaEntreContas(l)) { transferencias += v; return; }
    if (l.contrato_id) {
      const t = tipoDoContrato(l.contrato_id);
      if (t === "socio") socios += v;
      else if (t === "administrativo") administrativo += v;
      else contratos += v;
      return;
    }
    if (l.classificacao_id && tipoPorClassificacao.get(l.classificacao_id) === "administrativo") { administrativo += v; return; }
    // Sem contrato e sem classificação administrativa: não está em nenhum centro. Um lançamento rateado entra uma vez, com as fatias somadas.
    const parcela = l.numero_parcela ?? null;
    const chave = l.despesa_id ? `${l.origem}|${l.despesa_id}|${parcela ?? ""}|${l.data_pagamento ?? ""}` : `${l.origem}|#${i}`;
    const atual = por.get(chave);
    if (atual) { atual.valor = r2(atual.valor + v); return; }
    por.set(chave, {
      origem: l.origem,
      despesaId: l.despesa_id ?? null,
      numeroParcela: parcela,
      numero: l.id_malote ?? null,
      descricao: l.descricao ?? "",
      classificacao: l.classificacao_nome ?? null,
      data: l.data_pagamento ?? null,
      valor: r2(v),
      motivo: l.classificacao_id ? "contrato_nao_informado" : "sem_classificacao",
      responsaveis: l.classificacao_id ? (responsaveisPorClassificacao.get(l.classificacao_id) ?? []) : [],
    });
  });
  const lancamentos = Array.from(por.values()).sort((a, b) => b.valor - a.valor);
  const saldoUtilizavel = r2(saidaTotal - aplicacoes - transferencias);
  return {
    kind: "centros_fluxo",
    saidaTotal: r2(saidaTotal),
    aplicacoes: r2(aplicacoes),
    transferencias: r2(transferencias),
    saldoUtilizavel,
    contratos: r2(contratos),
    administrativo: r2(administrativo),
    socios: r2(socios),
    faltaDistribuir: r2(saldoUtilizavel - contratos - administrativo - socios),
    lancamentos,
  };
}

// Fluxo de Caixa abre direto na edição (reclassificar) do lançamento: origem|despesa|parcela. Só quem tem "alterar" no Fluxo edita.
export function linkReclassificarFluxo(mes: string, empresaId: string | null, l: Pick<LancamentoFaltaDistribuir, "origem" | "despesaId" | "numeroParcela" | "numero">): string {
  const base = linkFluxoCaixa(mes, empresaId);
  const q = new URLSearchParams();
  if (l.numero) q.set("busca", l.numero);
  if (l.despesaId) q.set("editar", [l.origem, l.despesaId, l.numeroParcela ?? ""].join("|"));
  const extra = q.toString();
  return extra ? `${base}&${extra}` : base;
}

// ── 7. Descontos por categoria ──────────────────────────────────────────────
export interface ItemDesconto {
  faltas: number;
  posto_nao_implementado: number;
  multas: number;
  glosas: number;
  outros_descontos: number;
  multas_pos_emissao: number;
  glosas_pos_emissao: number;
  outros_descontos_pos_emissao: number;
  vlr_materiais: number;
  total_descontos: number;
}

export function descontosPorCategoria(itens: ItemDesconto[]): { categorias: NonNullable<TotaisCard["detalhes"]>; totalCategorias: number; totalDescontado: number } {
  const soma = (f: (i: ItemDesconto) => number) => r2(itens.reduce((s, i) => s + (Number(f(i)) || 0), 0));
  const categorias = [
    { rotulo: "Faltas", valor: soma((i) => i.faltas), somaNoTotal: true },
    { rotulo: "Postos não implementados", valor: soma((i) => i.posto_nao_implementado), somaNoTotal: true },
    { rotulo: "Multas", valor: soma((i) => i.multas), somaNoTotal: true },
    { rotulo: "Glosas", valor: soma((i) => i.glosas), somaNoTotal: true },
    { rotulo: "Outros descontos", valor: soma((i) => i.outros_descontos), somaNoTotal: true },
    // SIS-2026-0609: pós-emissão não muda a NF (só o valor pago): aparece, não soma.
    { rotulo: "Descontos pós-emissão (reduzem o pagamento, não a NF — não soma)", valor: soma((i) => i.multas_pos_emissao + i.glosas_pos_emissao + i.outros_descontos_pos_emissao), somaNoTotal: false },
    // Materiais abatem a base do INSS, não o valor da nota: aparece, mas não soma.
    { rotulo: "Materiais (abate a base do INSS — não soma)", valor: soma((i) => i.vlr_materiais), somaNoTotal: false },
  ];
  return {
    categorias,
    totalCategorias: r2(categorias.filter((c) => c.somaNoTotal).reduce((s, c) => s + c.valor, 0)),
    totalDescontado: soma((i) => i.total_descontos),
  };
}

// ── 2. Conciliado com extrato ───────────────────────────────────────────────
export interface ConciliacaoCab { id: string; empresa_ids: string[]; todas_empresas: boolean }

export function conciliacaoDaEmpresa(c: ConciliacaoCab, empresaId: string | null): boolean {
  if (!empresaId) return true;
  return c.todas_empresas || c.empresa_ids.includes(empresaId);
}

// ── SIS-2026-0657: totais dos cards 1 a 4 ───────────────────────────────────
export interface LinhaFluxoAud {
  origem: string;
  tipo: "entrada" | "saida";
  valor: number;
  empresa_id: string | null;
  contrato_id: string | null;
  classificacao_id?: string | null;
  classificacao_nome: string | null;
  // Só as linhas do Malote trazem (view v_malote_pagamento_fluxo_caixa).
  despesa_id?: string | null;
  id_malote?: string | null;
  ajustado?: boolean | null;
  descricao?: string | null;
  data_pagamento?: string | null;
}

export const ORIGEM_MALOTE = "malote";
export const ORIGEM_APLICACAO = "aplicacao_financeira";
export const LABEL_ORIGEM_FINANCEIRO: Record<string, string> = {
  aplicacao_financeira: "Aplicações Financeiras",
  cartao_fatura: "Cartão de Crédito",
  debito_automatico: "Débito Automático",
  importacao_historica: "Importação (planilha de Fluxo 2026)",
};

// SIS-2026-0687: ordem em que as origens do Fluxo aparecem no card 1 (as demais vêm depois, da maior para a menor).
const ORDEM_ORIGENS_CARD1 = [ORIGEM_APLICACAO, "cartao_fatura", "debito_automatico"];

// "SALDO ANTERIOR" é a passagem de saldo do mês, não movimento.
export const ehSaldoAnterior = (l: Pick<LinhaFluxoAud, "classificacao_nome">) => (l.classificacao_nome ?? "").trim().toUpperCase() === "SALDO ANTERIOR";

// Aplicação financeira = giro de caixa. Vem de duas formas: as do módulo Aplicações Financeiras (origem própria)
// e as da planilha de Fluxo 2026 importada, que entram como origem "importação" com a classificação
// "Aplicação Financeira". As duas ficam fora do total de gasto.
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
export const ehAplicacao = (l: Pick<LinhaFluxoAud, "origem" | "classificacao_nome">) =>
  l.origem === ORIGEM_APLICACAO || semAcento((l.classificacao_nome ?? "").trim().toUpperCase()) === "APLICACAO FINANCEIRA";

const passaLinha = (f: FiltroAuditoria, l: Pick<LinhaFluxoAud, "empresa_id" | "contrato_id">) =>
  (!f.empresaId || l.empresa_id === f.empresaId) && (!f.contratoId || l.contrato_id === f.contratoId);

// Saídas de gasto do Fluxo: tudo menos Aplicação Financeira (giro de caixa) e saldo anterior.
export function saidasDeGasto(fluxo: LinhaFluxoAud[], filtro: FiltroAuditoria): LinhaFluxoAud[] {
  return fluxo.filter((l) => l.tipo === "saida" && !ehAplicacao(l) && !ehSaldoAnterior(l) && passaLinha(filtro, l));
}

// "Lançamentos do Financeiro" = o que está no Fluxo e NÃO veio do Malote (Débito Automático, fatura de
// cartão, importação histórica...), já sem aplicação financeira.
export function saidasFinanceiro(fluxo: LinhaFluxoAud[], filtro: FiltroAuditoria): LinhaFluxoAud[] {
  return saidasDeGasto(fluxo, filtro).filter((l) => l.origem !== ORIGEM_MALOTE);
}

// SIS-2026-0687: a linha do Fluxo faz parte da origem de um tile do card 1? É a mesma separação do total: aplicação
// financeira (origem própria ou classificação "Aplicação Financeira" da planilha) é uma origem só, e o saldo anterior nunca
// conta. O Fluxo de Caixa usa isto no filtro "Origem" para abrir já no que o tile somou.
export function linhaDaOrigemDoCard(l: Pick<LinhaFluxoAud, "origem" | "classificacao_nome">, origem: string): boolean {
  if (ehSaldoAnterior(l)) return false;
  if (origem === ORIGEM_APLICACAO) return ehAplicacao(l);
  return l.origem === origem && !ehAplicacao(l);
}

// SIS-2026-0687: o card 1 confere o Malote e TODAS as origens que alimentam o Fluxo (Aplicações Financeiras, Cartão de
// Crédito, Débito Automático...) contra o TOTAL de saídas do Fluxo. Só o "saldo anterior" (passagem de saldo do mês, não
// movimento) fica de fora. O card 3 continua sem aplicação: lá o que se compara é gasto de centro de custo.
export function totaisMaloteFinanceiro(maloteDireto: number, fluxo: LinhaFluxoAud[], filtro: FiltroAuditoria): { a: number; b: number; painel: PainelMaloteFluxo } {
  const saidas = fluxo.filter((l) => l.tipo === "saida" && !ehSaldoAnterior(l) && passaLinha(filtro, l));
  const outras = saidas.filter((l) => l.origem !== ORIGEM_MALOTE);
  const porOrigem = new Map<string, number>();
  // Aplicação financeira vira uma origem só, venha do módulo próprio ou da planilha de Fluxo importada.
  for (const l of outras) {
    const chave = ehAplicacao(l) ? ORIGEM_APLICACAO : l.origem;
    porOrigem.set(chave, (porOrigem.get(chave) ?? 0) + (Number(l.valor) || 0));
  }
  const soma = (ls: LinhaFluxoAud[]) => r2(ls.reduce((s, l) => s + (Number(l.valor) || 0), 0));
  const posicao = (o: string) => { const i = ORDEM_ORIGENS_CARD1.indexOf(o); return i === -1 ? ORDEM_ORIGENS_CARD1.length : i; };
  const totalFinanceiro = soma(outras);
  return {
    a: r2(maloteDireto + totalFinanceiro),
    b: soma(saidas),
    painel: {
      kind: "malote_fluxo",
      malote: r2(maloteDireto),
      financeiro: totalFinanceiro,
      financeiroPorOrigem: Array.from(porOrigem.entries())
        .map(([origem, valor]) => ({ origem, valor: r2(valor) }))
        .sort((x, y) => posicao(x.origem) - posicao(y.origem) || y.valor - x.valor),
      fluxoSaidas: soma(saidas),
      aplicacoes: r2(porOrigem.get(ORIGEM_APLICACAO) ?? 0),
      divergencias: [],
    },
  };
}

export function entradasSaidas(linhas: { tipo: "entrada" | "saida"; valor: number }[]): EntradasSaidas {
  let entradas = 0, saidas = 0;
  for (const l of linhas) {
    const v = Number(l.valor) || 0;
    if (l.tipo === "entrada") entradas += v;
    else saidas += v;
  }
  return { entradas: r2(entradas), saidas: r2(saidas), movimentado: r2(entradas + saidas), saldo: r2(entradas - saidas) };
}

// Card 2: Fluxo × Extrato. O extrato só cobre os bancos cujo OFX foi conciliado, então o Fluxo é recortado
// igual à conciliação (mesmo banco, empresas e sem os lançamentos que ela ignora). Entradas e saídas
// separadas. O total do extrato vem do cabeçalho da conciliação (extrato_entradas/extrato_saidas).
export interface ConciliacaoAud {
  id: string;
  banco_id: string | null;
  empresa_ids: string[] | null;
  todas_empresas: boolean;
  data_inicio?: string;
  data_fim?: string;
  created_at?: string;
  extrato_entradas?: number | null;
  extrato_saidas?: number | null;
}

// A mesma conta/período salvo mais de uma vez (acontece) conta UMA vez: vale a mais recente.
export function conciliacoesUnicas(cabs: ConciliacaoAud[]): ConciliacaoAud[] {
  const por = new Map<string, ConciliacaoAud>();
  for (const c of cabs) {
    const chave = [c.banco_id ?? "", c.todas_empresas ? "*" : [...(c.empresa_ids ?? [])].sort().join(","), c.data_inicio ?? "", c.data_fim ?? ""].join("|");
    const atual = por.get(chave);
    if (!atual || (c.created_at ?? "") > (atual.created_at ?? "")) por.set(chave, c);
  }
  return Array.from(por.values());
}

export function totaisFluxoExtrato(
  fluxo: (LinhaFluxoAud & { banco_id?: string | null; banco_nome?: string | null; descricao?: string | null })[],
  conciliacoesSalvas: ConciliacaoAud[],
  empresaId: string | null,
  ignora: (l: LinhaFluxoAud & { banco_nome?: string | null; descricao?: string | null }) => boolean = () => false
): { a: number; b: number; painel: PainelFluxoExtrato } {
  const doEscopo = conciliacoesUnicas(conciliacoesSalvas.filter((c) => conciliacaoDaEmpresa({ id: c.id, empresa_ids: c.empresa_ids ?? [], todas_empresas: c.todas_empresas }, empresaId)));
  const daEmpresa = fluxo.filter((l) => !empresaId || l.empresa_id === empresaId);
  const doMes = daEmpresa.filter((l) => !ehSaldoAnterior(l));
  const fluxoMes = entradasSaidas(doMes);

  const conciliado = doEscopo.length > 0;
  const cobre = (l: { banco_id?: string | null; empresa_id: string | null }) =>
    doEscopo.some((c) => !!c.banco_id && l.banco_id === c.banco_id && (c.todas_empresas || (!!l.empresa_id && (c.empresa_ids ?? []).includes(l.empresa_id))));
  const doRecorte = conciliado ? doMes.filter((l) => !ignora(l) && cobre(l)) : doMes;
  const fluxoRecorte = entradasSaidas(doRecorte);
  // SIS-2026-0701: a tela do Fluxo de Caixa soma TUDO do período, inclusive o "saldo anterior" (abertura) nas entradas; o recorte da
  // conciliação não. A ponte mostra cada parte que sai do total até o recorte, para as entradas e saídas baterem com a tela do Fluxo.
  const ponte: PontePainelFluxo | null = conciliado
    ? {
        total: entradasSaidas(daEmpresa),
        saldoAnterior: entradasSaidas(daEmpresa.filter(ehSaldoAnterior)),
        semConciliacao: entradasSaidas(doMes.filter((l) => !cobre(l))),
        ignorados: entradasSaidas(doMes.filter((l) => cobre(l) && ignora(l))),
      }
    : null;

  let entradas = 0, saidas = 0, semTotais = 0;
  for (const c of doEscopo) {
    if (c.extrato_entradas === null || c.extrato_entradas === undefined || c.extrato_saidas === null || c.extrato_saidas === undefined) { semTotais += 1; continue; }
    entradas += Number(c.extrato_entradas) || 0;
    saidas += Number(c.extrato_saidas) || 0;
  }
  const extrato: EntradasSaidas = { entradas: r2(entradas), saidas: r2(saidas), movimentado: r2(entradas + saidas), saldo: r2(entradas - saidas) };

  const nomes = new Map<string, string>();
  for (const l of doRecorte) if (conciliado && l.banco_id && l.banco_nome) nomes.set(l.banco_id, l.banco_nome);
  return {
    a: fluxoRecorte.movimentado,
    b: extrato.movimentado,
    painel: {
      kind: "fluxo_extrato",
      fluxo: fluxoRecorte,
      extrato,
      difEntradas: r2(fluxoRecorte.entradas - extrato.entradas),
      difSaidas: r2(fluxoRecorte.saidas - extrato.saidas),
      conciliacoes: doEscopo.length,
      conciliado,
      fluxoMes,
      cobertura: conciliado && fluxoMes.saidas > 0 ? fluxoRecorte.saidas / fluxoMes.saidas : null,
      bancos: Array.from(new Set(nomes.values())).sort((a, b) => a.localeCompare(b, "pt-BR")),
      semTotais,
      ponte,
    },
  };
}

export interface CentroOrcamento { nome: string; orcado: number; realizado: number }

// Card 4: centros de custo que mais consumiram acima do orçado (só os que estouraram).
export function centrosAcimaDoOrcado(centros: CentroOrcamento[], max = 3): PainelOrcadoRealizado {
  const estouros = centros
    .map((c) => ({ nome: c.nome, excesso: r2(c.realizado - c.orcado) }))
    .filter((c) => c.excesso > TOLERANCIA)
    .sort((a, b) => b.excesso - a.excesso);
  const principais = estouros.slice(0, max);
  const resto = estouros.slice(max);
  return {
    kind: "orcado_realizado",
    principais,
    outros: r2(resto.reduce((s, c) => s + c.excesso, 0)),
    outrosQtd: resto.length,
    totalAcima: r2(estouros.reduce((s, c) => s + c.excesso, 0)),
  };
}

// ── Links para conferir de onde vem o valor ─────────────────────────────────
export interface LinkCard { rotulo: string; to: string }

export function periodoDoMes(anoMes: string): { de: string; ate: string } {
  const [a, m] = anoMes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { de: `${anoMes}-01`, ate: `${anoMes}-${String(ultimo).padStart(2, "0")}` };
}

// O Fluxo de Caixa abre já no período (e na empresa) que o painel está mostrando.
export function linkFluxoCaixa(mes: string, empresaId: string | null): string {
  const { de, ate } = periodoDoMes(mes);
  const q = new URLSearchParams({ de, ate });
  if (empresaId) q.set("empresa", empresaId);
  return `/app/financeiro/gestao-financeira/fluxo-caixa?${q.toString()}`;
}

// SIS-2026-0720: o card 2 leva à Conciliação Bancária (Dashboard) já na competência e na empresa da auditoria, com os valores que a auditoria
// mostra (Fluxo × extrato nos bancos conciliados) para conferir lá.
export function linkConciliacao(mes: string, empresaId: string | null, p?: Pick<PainelFluxoExtrato, "fluxo" | "extrato">): string {
  const q = new URLSearchParams({ aba: "dashboard", mes });
  if (empresaId) q.set("empresa", empresaId);
  if (p) {
    q.set("fe", String(p.fluxo.entradas)); q.set("fs", String(p.fluxo.saidas));
    q.set("ee", String(p.extrato.entradas)); q.set("es", String(p.extrato.saidas));
  }
  return `/app/financeiro/gestao-financeira/conciliacao-fluxo-caixa?${q.toString()}`;
}

export function linksDoCard(tipo: TipoValidacao, mes: string, empresaId: string | null): LinkCard[] {
  const malote = { rotulo: "Malote", to: "/app/malote/pagamento" };
  const fluxo = { rotulo: "Fluxo de Caixa", to: linkFluxoCaixa(mes, empresaId) };
  switch (tipo) {
    case "malote_fluxo": return [malote, fluxo];
    case "fluxo_extrato": return [malote, fluxo, { rotulo: "Conciliação Bancária", to: linkConciliacao(mes, empresaId) }];
    case "centros_malote": return [{ rotulo: "Fluxo de Caixa", to: linkFluxoCaixa(mes, empresaId) }, { rotulo: "Centros de Custo", to: "/app/controladoria/centros-custo" }];
    case "orcado_realizado": return [fluxo, { rotulo: "Orçamento Geral", to: "/app/malote/orcamento-geral" }];
    default: return [];
  }
}

// ── SIS-2026-0657: relatório das despesas que divergem entre Malote e Fluxo ─
export const LABEL_MOTIVO_DIVERGENCIA: Record<MotivoDivergencia, string> = {
  ajustado_no_fluxo: "Valor ajustado só no Fluxo de Caixa",
  so_no_malote: "Está no Malote e não está no Fluxo deste mês (data mudou ou lançamento removido do Fluxo)",
  so_no_fluxo: "Está no Fluxo deste mês e não no Malote (data ajustada no Fluxo)",
  valor_diferente: "Valor diferente entre Malote e Fluxo",
};

// Compara, despesa a despesa, o Malote lido direto das tabelas com as linhas de Malote do Fluxo.
export function divergenciasMaloteFluxo(
  direto: Map<string, { valor: number; numero: string | null }>,
  fluxo: LinhaFluxoAud[],
  filtro: FiltroAuditoria
): DivergenciaMalote[] {
  const doFluxo = new Map<string, { valor: number; numero: string | null; ajustado: boolean }>();
  for (const l of fluxo) {
    if (l.origem !== ORIGEM_MALOTE || l.tipo !== "saida" || !l.despesa_id || !passaLinha(filtro, l)) continue;
    const atual = doFluxo.get(l.despesa_id) ?? { valor: 0, numero: l.id_malote ?? null, ajustado: false };
    atual.valor += Number(l.valor) || 0;
    atual.ajustado = atual.ajustado || !!l.ajustado;
    doFluxo.set(l.despesa_id, atual);
  }
  const ids = new Set<string>([...direto.keys(), ...doFluxo.keys()]);
  const saida: DivergenciaMalote[] = [];
  ids.forEach((id) => {
    const m = direto.get(id);
    const f = doFluxo.get(id);
    const valorM = r2(m?.valor ?? 0), valorF = r2(f?.valor ?? 0);
    const dif = r2(valorM - valorF);
    if (Math.abs(dif) < 0.005) return;
    const motivo: MotivoDivergencia = !f ? "so_no_malote" : !m ? "so_no_fluxo" : f.ajustado ? "ajustado_no_fluxo" : "valor_diferente";
    saida.push({ despesaId: id, numero: m?.numero ?? f?.numero ?? null, malote: valorM, fluxo: valorF, diferenca: dif, motivo });
  });
  return saida.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));
}

// Texto para colar (ex.: na justificativa de uma rejeição ou num e-mail para quem corrige).
export function relatorioDivergencias(divs: DivergenciaMalote[], autores?: Map<string, string>): string {
  if (divs.length === 0) return "Nenhuma despesa divergente entre Malote e Fluxo de Caixa.";
  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const linhas = divs.map((d) => {
    const autor = autores?.get(d.despesaId);
    return `- ${d.numero ?? d.despesaId}: Malote ${brl(d.malote)} · Fluxo ${brl(d.fluxo)} · diferença ${brl(d.diferenca)} — ${LABEL_MOTIVO_DIVERGENCIA[d.motivo]}${autor ? ` (${autor})` : ""}`;
  });
  return `Despesas divergentes entre Malote e Fluxo de Caixa (${divs.length}):\n${linhas.join("\n")}`;
}

// ── SIS-2026-0657: lançamentos "sem centro" do card 3 e formato da cobertura ─
export const LABEL_ORIGEM_LANCAMENTO: Record<string, string> = { malote: "Malote", ...LABEL_ORIGEM_FINANCEIRO };
export const LABEL_MOTIVO_SEM_CENTRO: Record<LancamentoSemCentro["motivo"], string> = {
  sem_classificacao: "Sem classificação",
  contrato_nao_informado: "Classificação de contrato, mas sem contrato informado",
};

// Mesma regra de totaisCentrosMalote, só que devolvendo QUAIS lançamentos ficaram sem centro (maiores primeiro).
// Um lançamento rateado entra uma vez só, com as fatias somadas.
export function semCentroDetalhe(linhas: LinhaCentroMalote[], tipoPorClassificacao: Map<string, string | null>, filtro: FiltroAuditoria): LancamentoSemCentro[] {
  const por = new Map<string, LancamentoSemCentro>();
  linhas.forEach((l, i) => {
    if (!passaFiltro(filtro, l.empresa_id, l.contrato_id)) return;
    if (l.contrato_id) return;
    if (l.classificacao_id && tipoPorClassificacao.get(l.classificacao_id) === "administrativo") return;
    const origem = l.origem ?? "malote";
    const chave = l.despesa_id ? `${origem}|${l.despesa_id}|${l.data_pagamento ?? ""}` : `${origem}|#${i}`;
    const atual = por.get(chave);
    const v = Number(l.valor) || 0;
    if (atual) { atual.valor = r2(atual.valor + v); return; }
    por.set(chave, {
      origem,
      despesaId: l.despesa_id ?? null,
      numero: l.id_malote ?? null,
      descricao: l.descricao ?? "",
      classificacao: l.classificacao_nome ?? null,
      data: l.data_pagamento ?? null,
      valor: r2(v),
      motivo: l.classificacao_id ? "contrato_nao_informado" : "sem_classificacao",
    });
  });
  return Array.from(por.values()).sort((a, b) => b.valor - a.valor);
}

export function relatorioSemCentro(lista: LancamentoSemCentro[]): string {
  if (lista.length === 0) return "Nenhum lançamento sem centro de custo.";
  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const dia = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "sem data");
  const linhas = lista.map((l) => `- ${l.numero ?? "sem ID"} (${LABEL_ORIGEM_LANCAMENTO[l.origem] ?? l.origem}, ${dia(l.data)}): ${l.descricao || "sem descrição"} — ${brl(l.valor)} — ${LABEL_MOTIVO_SEM_CENTRO[l.motivo]}${l.classificacao ? ` [${l.classificacao}]` : ""}`);
  return `Lançamentos sem centro de custo (${lista.length}, total ${brl(lista.reduce((s, l) => s + l.valor, 0))}):\n${linhas.join("\n")}`;
}

// Percentual da cobertura da conciliação: abaixo de 10% mostra uma casa decimal, senão 0,3% aparecia como "0%".
export function fmtPercentual(frac: number): string {
  const p = frac * 100;
  return `${(p < 10 ? Math.round(p * 10) / 10 : Math.round(p)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
