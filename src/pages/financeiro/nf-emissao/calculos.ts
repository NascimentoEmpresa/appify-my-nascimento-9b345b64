export const INSS_CATEGORIAS = {
  normais: { label: "Normais", pct: 0.11 },
  insalubridade_20: { label: "Insalubridade 20%", pct: 0.13 },
  periculosidade_30: { label: "Periculosidade 30%", pct: 0.14 },
  insalubridade_40: { label: "Insalubridade 40%", pct: 0.15 },
} as const;

export type InssCategoria = keyof typeof INSS_CATEGORIAS;

export interface ItemInput {
  valor_contrato_exec: number;
  vlr_va: number;
  vlr_vt: number;
  vlr_materiais: number;
  faltas: number;
  posto_nao_implementado: number;
  multas: number;
  glosas: number;
  outros_descontos: number;
  multas_pos_emissao: number;
  glosas_pos_emissao: number;
  outros_descontos_pos_emissao: number;
  qtd_colaboradores: number;
  inss_categoria: InssCategoria;
}

export interface ItemCalculado extends ItemInput {
  vlr_bruto: number;
  total_descontos: number;
  vlr_mao_obra: number;
  vlr_liquido: number;
  issqn: number;
  inss: number;
  ir: number;
  cofins: number;
  pis: number;
  csll: number;
}

export interface PercentuaisFiscais {
  issqn_pct: number;
  ir_pct: number;
  cofins_pct: number;
  pis_pct: number;
  csll_pct: number;
}

// Reproduz o cálculo real da planilha "Modelo" (SAMU.xlsm / TJRS.xlsm):
// total_descontos = faltas + posto não implementado + multas + glosas + outros descontos
//   (+ multas/glosas/outros descontos pós-emissão, lançados pelo Financeiro no Controle de Notas)
// vlr_bruto = valor contrato exec. - total_descontos
// vlr_mao_obra = vlr_bruto - VA - VT - materiais
// ISSQN/IR/COFINS/PIS/CSLL = vlr_bruto * percentual do contrato
// INSS = vlr_mao_obra * alíquota da categoria de risco do item (padrão legal fixo, não do contrato)
// vlr_liquido = vlr_bruto - todas as retenções
export function calcularItem(input: ItemInput, pct: PercentuaisFiscais): ItemCalculado {
  const total_descontos =
    input.faltas +
    input.posto_nao_implementado +
    input.multas +
    input.multas_pos_emissao +
    input.glosas +
    input.glosas_pos_emissao +
    input.outros_descontos +
    input.outros_descontos_pos_emissao;
  const vlr_bruto = input.valor_contrato_exec - total_descontos;
  const vlr_mao_obra = vlr_bruto - input.vlr_va - input.vlr_vt - input.vlr_materiais;

  const issqn = vlr_bruto * pct.issqn_pct;
  const ir = vlr_bruto * pct.ir_pct;
  const cofins = vlr_bruto * pct.cofins_pct;
  const pis = vlr_bruto * pct.pis_pct;
  const csll = vlr_bruto * pct.csll_pct;
  const inss = vlr_mao_obra * INSS_CATEGORIAS[input.inss_categoria].pct;

  const vlr_liquido = vlr_bruto - issqn - inss - ir - cofins - pis - csll;

  return {
    ...input,
    vlr_bruto,
    total_descontos,
    vlr_mao_obra,
    vlr_liquido,
    issqn,
    inss,
    ir,
    cofins,
    pis,
    csll,
  };
}

const SOMA_FIELDS = [
  "valor_contrato_exec",
  "vlr_bruto",
  "vlr_liquido",
  "issqn",
  "inss",
  "ir",
  "cofins",
  "pis",
  "csll",
] as const;

export interface TotaisNf {
  valor_contrato_exec_total: number;
  vlr_bruto_total: number;
  vlr_liquido_total: number;
  issqn_total: number;
  inss_total: number;
  ir_total: number;
  cofins_total: number;
  pis_total: number;
  csll_total: number;
}

export function calcularTotaisNf(itens: ItemCalculado[]): TotaisNf {
  const soma = (key: (typeof SOMA_FIELDS)[number]) => itens.reduce((s, it) => s + (it[key] || 0), 0);
  return {
    valor_contrato_exec_total: soma("valor_contrato_exec"),
    vlr_bruto_total: soma("vlr_bruto"),
    vlr_liquido_total: soma("vlr_liquido"),
    issqn_total: soma("issqn"),
    inss_total: soma("inss"),
    ir_total: soma("ir"),
    cofins_total: soma("cofins"),
    pis_total: soma("pis"),
    csll_total: soma("csll"),
  };
}
