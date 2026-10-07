export const INSS_CATEGORIAS = {
  normais: { label: "Normais", pct: 0.11 },
  insalubridade_20: { label: "Insalubridade 20%", pct: 0.13 },
  periculosidade_30: { label: "Periculosidade 30%", pct: 0.14 },
  insalubridade_40: { label: "Insalubridade 40%", pct: 0.15 },
  // [SEM-CHAMADO] (pedido urgente do Ruan): nota fiscal de material do SEMAE não retém INSS.
  // Última da lista (as categorias de risco seguem como estavam); 0% zera o INSS do item.
  nao_reter: { label: "Não reter", pct: 0 },
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
  // Override opcional de retenção por item (ex: UFFS mistura postos com IR
  // diferente na mesma nota — Limpeza/Jardinagem num código de receita,
  // Motorista/Serviços Gerais/Intérprete/Encarregado noutro). Nulo/ausente =
  // usa o percentual padrão da nota (comportamento de sempre).
  issqn_pct?: number | null;
  ir_pct?: number | null;
  cofins_pct?: number | null;
  pis_pct?: number | null;
  csll_pct?: number | null;
  // SIS-2026-0578: motivo dos descontos, exigido na tela quando há valor.
  justificativa_multas?: string | null;
  justificativa_glosas?: string | null;
  justificativa_outros_descontos?: string | null;
  // Item importado da planilha legada (SIS-2026-0540): a planilha traz os
  // valores JÁ calculados pelo Financeiro, que discriminava VA/VT/materiais lá
  // — esses três campos não vêm pro ERP. Recalcular pela regra do ERP (com
  // VA/VT/materiais = 0) muda INSS/ISSQN/IR/líquido e a nota abria diferente
  // do Relatório (ex. NF 238: R$ 9.390,79 × R$ 9.533,79 salvo, que é o certo).
  // Quando preenchido, valem os valores gravados (ver valoresLegadosDoItem).
  valores_legados?: ValoresLegadosItem | null;
}

export interface ValoresLegadosItem {
  vlr_bruto: number;
  issqn: number;
  inss: number;
  ir: number;
  cofins: number;
  pis: number;
  csll: number;
  vlr_liquido: number;
}

// Item legado: a planilha nunca gravou a mão de obra (fica 0) nem VA/VT/
// materiais, mas gravou o bruto e as retenções. Item criado pelo ERP sempre
// tem mão de obra > 0 gravada, então não cai aqui.
export function valoresLegadosDoItem(r: {
  vlr_va: number; vlr_vt: number; vlr_materiais: number;
  vlr_mao_obra?: number | null; vlr_bruto?: number | null; vlr_liquido?: number | null;
  issqn?: number | null; inss?: number | null; ir?: number | null;
  cofins?: number | null; pis?: number | null; csll?: number | null;
}): ValoresLegadosItem | null {
  const semDetalhe = (r.vlr_va || 0) + (r.vlr_vt || 0) + (r.vlr_materiais || 0) === 0;
  if (!semDetalhe || (r.vlr_mao_obra ?? 0) !== 0 || !((r.vlr_bruto ?? 0) > 0)) return null;
  return {
    vlr_bruto: Number(r.vlr_bruto),
    issqn: Number(r.issqn ?? 0),
    inss: Number(r.inss ?? 0),
    ir: Number(r.ir ?? 0),
    cofins: Number(r.cofins ?? 0),
    pis: Number(r.pis ?? 0),
    csll: Number(r.csll ?? 0),
    vlr_liquido: Number(r.vlr_liquido ?? 0),
  };
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

// Achado real (Ruan, NF 1186 Caxias do Sul): nota importada da planilha legada
// (SIS-2026-0540) traz os TOTAIS de retenção (issqn_total, ir_total...) mas os
// percentuais ficam 0 em nf_emissao — quem recalcula a nota a partir do
// percentual (NF Concluída, Controle de Notas) zerava ISSQN/IR e o líquido
// divergia do Relatório (R$ 40.839,73 na nota × R$ 36.801,65 no relatório).
// Se a nota não tem nenhum percentual salvo mas tem retenção salva, deriva o
// percentual de total/bruto (arredondado em 4 casas: 4% e 4,8% saem exatos).
export function pctFiscaisDaNf(nf: {
  issqn_pct: number; ir_pct: number; cofins_pct: number; pis_pct: number; csll_pct: number;
  vlr_bruto_total: number;
  issqn_total: number; ir_total: number; cofins_total: number; pis_total: number; csll_total: number;
}): PercentuaisFiscais {
  const salvos: PercentuaisFiscais = {
    issqn_pct: nf.issqn_pct, ir_pct: nf.ir_pct, cofins_pct: nf.cofins_pct, pis_pct: nf.pis_pct, csll_pct: nf.csll_pct,
  };
  const algumPercentual = Object.values(salvos).some((p) => p > 0);
  if (algumPercentual || !(nf.vlr_bruto_total > 0)) return salvos;
  const deriva = (total: number) => Math.round(((total || 0) / nf.vlr_bruto_total) * 10000) / 10000;
  return {
    issqn_pct: deriva(nf.issqn_total), ir_pct: deriva(nf.ir_total), cofins_pct: deriva(nf.cofins_total),
    pis_pct: deriva(nf.pis_total), csll_pct: deriva(nf.csll_total),
  };
}

// Resolve o percentual que vale pra este item: override do item, se houver,
// senão o padrão da nota/contrato.
export function pctEfetivo(
  item: Pick<ItemInput, "issqn_pct" | "ir_pct" | "cofins_pct" | "pis_pct" | "csll_pct">,
  padrao: PercentuaisFiscais
): PercentuaisFiscais {
  return {
    issqn_pct: item.issqn_pct ?? padrao.issqn_pct,
    ir_pct: item.ir_pct ?? padrao.ir_pct,
    cofins_pct: item.cofins_pct ?? padrao.cofins_pct,
    pis_pct: item.pis_pct ?? padrao.pis_pct,
    csll_pct: item.csll_pct ?? padrao.csll_pct,
  };
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
  if (input.valores_legados) {
    // Nota importada da planilha: valem os valores gravados (ver ItemInput).
    // A mão de obra mostrada é a implícita no INSS (INSS ÷ alíquota); sem INSS,
    // é o próprio bruto.
    const v = input.valores_legados;
    const aliquota = INSS_CATEGORIAS[input.inss_categoria].pct;
    return {
      ...input,
      vlr_bruto: v.vlr_bruto,
      total_descontos,
      vlr_mao_obra: aliquota > 0 && v.inss > 0 ? Math.round((v.inss / aliquota) * 100) / 100 : v.vlr_bruto,
      vlr_liquido: v.vlr_liquido,
      issqn: v.issqn,
      inss: v.inss,
      ir: v.ir,
      cofins: v.cofins,
      pis: v.pis,
      csll: v.csll,
    };
  }
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
  "vlr_mao_obra",
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
  // [SEM-CHAMADO] (pedido do usuário): informativo de Mão de Obra em
  // destaque no cadastro — já existia por item (vlr_mao_obra), faltava o
  // total da nota.
  vlr_mao_obra_total: number;
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
    vlr_mao_obra_total: soma("vlr_mao_obra"),
    vlr_liquido_total: soma("vlr_liquido"),
    issqn_total: soma("issqn"),
    inss_total: soma("inss"),
    ir_total: soma("ir"),
    cofins_total: soma("cofins"),
    pis_total: soma("pis"),
    csll_total: soma("csll"),
  };
}

// SIS-2026-0592: o Financeiro ajusta, numa NF já concluída, os valores que
// mudam depois da emissão: multas/glosas/outros descontos PÓS-emissão e
// VA/VT/materiais. Nota criada no ERP recalcula pela regra normal. Nota
// importada da planilha (valores_legados) tem os valores gravados como
// referência, e as retenções não podem ser refeitas sem VA/VT/materiais
// (a planilha os discriminava e eles não vieram):
//  - só descontos pós-emissão mudaram: a diferença é aplicada direto sobre o
//    bruto e o líquido gravados, e as retenções ficam como estão;
//  - o Financeiro informou VA/VT/materiais: a nota deixa de ser "legada" e
//    passa a ser recalculada pela regra do ERP (INSS sobre bruto − VA − VT −
//    materiais). Informando os valores certos da planilha, o INSS e o líquido
//    voltam a bater com o gravado.
export interface DescontosPosEmissao {
  multas_pos_emissao: number;
  glosas_pos_emissao: number;
  outros_descontos_pos_emissao: number;
}

export interface AjusteValoresItem extends DescontosPosEmissao {
  vlr_va: number;
  vlr_vt: number;
  vlr_materiais: number;
}

export function somaDescontosPosEmissao(d: DescontosPosEmissao): number {
  return d.multas_pos_emissao + d.glosas_pos_emissao + d.outros_descontos_pos_emissao;
}

export function ajustarValoresNfConcluida(
  base: ItemInput,
  pct: PercentuaisFiscais,
  novos: AjusteValoresItem
): ItemCalculado {
  const item: ItemInput = { ...base, ...novos };
  if (base.valores_legados) {
    if (novos.vlr_va + novos.vlr_vt + novos.vlr_materiais > 0) {
      item.valores_legados = null;
    } else {
      const delta = Math.round((somaDescontosPosEmissao(novos) - somaDescontosPosEmissao(base)) * 100) / 100;
      item.valores_legados = {
        ...base.valores_legados,
        vlr_bruto: Math.round((base.valores_legados.vlr_bruto - delta) * 100) / 100,
        vlr_liquido: Math.round((base.valores_legados.vlr_liquido - delta) * 100) / 100,
      };
    }
  }
  return calcularItem(item, pct);
}

// Só os descontos pós-emissão (VA/VT/materiais ficam como estão).
export function ajustarDescontosPosEmissao(
  base: ItemInput,
  pct: PercentuaisFiscais,
  novos: DescontosPosEmissao
): ItemCalculado {
  return ajustarValoresNfConcluida(base, pct, { ...novos, vlr_va: base.vlr_va, vlr_vt: base.vlr_vt, vlr_materiais: base.vlr_materiais });
}

// SIS-2026-0591 (Ana): na emissão da NF a prefeitura pede as retenções federais
// PIS + COFINS + CSLL juntas, então a validação mostra o total somado.
export function somaRetencoesPisCofinsCsll(t: { pis_total: number; cofins_total: number; csll_total: number }): number {
  return Math.round(((t.pis_total || 0) + (t.cofins_total || 0) + (t.csll_total || 0)) * 100) / 100;
}
