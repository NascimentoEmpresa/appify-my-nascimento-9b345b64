import type { NfEmissaoItemRow } from "@/hooks/useNfEmissao";
import { valoresLegadosDoItem } from "./calculos";
import type { ItemForm } from "./ItensNfEditor";

// Item gravado da NF → o formato do ItensNfEditor (mesma conversão que o Relatório de Serviços e o Controle de Notas já fazem em cópia local).
// Usado pelo detalhe da NF na Emissão, para mostrar o item expandido (VA, VT, faltas, descontos, categoria de risco e retenção própria).
export function itemRowParaForm(r: NfEmissaoItemRow): ItemForm {
  return {
    identificacao: r.identificacao ?? "",
    valor_contrato_exec: r.valor_contrato_exec,
    vlr_va: r.vlr_va,
    vlr_vt: r.vlr_vt,
    vlr_materiais: r.vlr_materiais,
    faltas: r.faltas,
    posto_nao_implementado: r.posto_nao_implementado,
    multas: r.multas,
    glosas: r.glosas,
    outros_descontos: r.outros_descontos,
    multas_pos_emissao: r.multas_pos_emissao,
    glosas_pos_emissao: r.glosas_pos_emissao,
    outros_descontos_pos_emissao: r.outros_descontos_pos_emissao,
    justificativa_multas: r.justificativa_multas,
    justificativa_glosas: r.justificativa_glosas,
    justificativa_outros_descontos: r.justificativa_outros_descontos,
    qtd_colaboradores: r.qtd_colaboradores,
    inss_categoria: r.inss_categoria,
    valores_legados: valoresLegadosDoItem(r),
    issqn_pct: r.issqn_pct,
    ir_pct: r.ir_pct,
    cofins_pct: r.cofins_pct,
    pis_pct: r.pis_pct,
    csll_pct: r.csll_pct,
  };
}
