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
  { tipo: "malote_fluxo", numero: 1, titulo: "Conciliação do Malote em relação ao Fluxo de Caixa", rotuloA: "Total Malote", rotuloB: "Total no Fluxo de Caixa", comparacao: "igual", link: "/app/financeiro/gestao-financeira/fluxo-caixa", linkRotulo: "Fluxo de Caixa" },
  { tipo: "fluxo_extrato", numero: 2, titulo: "Conciliação do Fluxo de Caixa em relação ao Extrato", rotuloA: "Total no Fluxo de Caixa", rotuloB: "Total conciliado com extratos", comparacao: "igual", link: "/app/financeiro/gestao-financeira/conciliacao-fluxo-caixa", linkRotulo: "Conciliação Bancária" },
  { tipo: "centros_malote", numero: 3, titulo: "Conciliação de gastos dos Centros de Custo em relação ao Malote", rotuloA: "Total no Malote", rotuloB: "Total em Centros de Custo (contratos + administrativo)", comparacao: "igual", link: "/app/controladoria/centros-custo", linkRotulo: "Centros de Custo" },
  { tipo: "orcado_realizado", numero: 4, titulo: "Comparativo de Orçado × Realizado", rotuloA: "Total Orçado", rotuloB: "Total Realizado", comparacao: "livre", link: "/app/malote/orcamento-geral", linkRotulo: "Orçamento Geral" },
  { tipo: "faturado", numero: 5, titulo: "Totais de notas faturadas × falta faturar", rotuloA: "Total Faturado", rotuloB: "Falta Faturar", comparacao: "livre", link: "/app/controladoria/controle-faturamento", linkRotulo: "Controle de Faturamento" },
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
}

export function diferenca(t: Pick<TotaisCard, "a" | "b">): { valor: number; percentual: number | null } {
  const valor = r2(t.a - t.b);
  return { valor, percentual: t.a !== 0 ? valor / t.a : null };
}

export type SituacaoComparacao = "confere" | "diverge" | "informativo";

export function situacaoComparacao(def: Pick<DefValidacao, "comparacao">, t: Pick<TotaisCard, "a" | "b">): SituacaoComparacao {
  if (def.comparacao === "livre") return "informativo";
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
  const rateioPorDespesa = new Map<string, RateioMalote[]>();
  for (const r of rateios) {
    const arr = rateioPorDespesa.get(r.despesa_id) ?? [];
    arr.push(r);
    rateioPorDespesa.set(r.despesa_id, arr);
  }
  let total = 0;
  for (const d of despesasNaoParceladas) {
    const linhas = rateioPorDespesa.get(d.id);
    if (linhas?.length) {
      for (const l of linhas) if (passaFiltro(filtro, l.empresa_id ?? d.empresa_id, l.contrato_id ?? d.contrato_id)) total += Number(l.valor) || 0;
    } else if (passaFiltro(filtro, d.empresa_id, d.contrato_id)) {
      total += Number(d.valor_aprovado) || 0;
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
        total += (Number(p.valor) || 0) * prop;
      }
    } else if (passaFiltro(filtro, d.empresa_id, d.contrato_id)) {
      total += Number(p.valor) || 0;
    }
  }
  return r2(total);
}

// ── 3. Centros de Custo × Malote ────────────────────────────────────────────
// O centro de custo operacional É o contrato (cada contrato é um centro) e o
// rateio do Malote já carrega o contrato; as classificações administrativas
// pertencem aos centros administrativos. Então todo gasto do Malote deveria cair
// em uma das duas. O que sobra é pendência real: classificação de CONTRATO
// lançada sem contrato (ou sem classificação) — não dá para atribuir a centro.
export interface LinhaCentroMalote { valor: number; empresa_id: string | null; contrato_id: string | null; classificacao_id: string | null }

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
    { rotulo: "Multas (inclui pós-emissão)", valor: soma((i) => i.multas + i.multas_pos_emissao), somaNoTotal: true },
    { rotulo: "Glosas (inclui pós-emissão)", valor: soma((i) => i.glosas + i.glosas_pos_emissao), somaNoTotal: true },
    { rotulo: "Outros descontos (inclui pós-emissão)", valor: soma((i) => i.outros_descontos + i.outros_descontos_pos_emissao), somaNoTotal: true },
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
