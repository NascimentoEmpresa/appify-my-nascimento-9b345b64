import { describe, expect, it } from "vitest";
import { COLUNAS_ITEM_NF, itemParaGravar, substituirItensNf } from "@/pages/financeiro/nf-emissao/itemParaGravar";
import { calcularItem, valoresLegadosDoItem, type ItemInput } from "@/pages/financeiro/nf-emissao/calculos";

// Incidente 06/10/2026 (NF 1416): o item em memória carrega `valores_legados`,
// que não é coluna de nf_emissao_item — o insert falhava depois de a nota já
// estar concluída e os itens apagados.
const base: ItemInput = {
  valor_contrato_exec: 10000, vlr_va: 0, vlr_vt: 0, vlr_materiais: 0,
  faltas: 0, posto_nao_implementado: 0, multas: 0, glosas: 0, outros_descontos: 0,
  multas_pos_emissao: 0, glosas_pos_emissao: 0, outros_descontos_pos_emissao: 0,
  qtd_colaboradores: 0, inss_categoria: "normais",
};
const pct = { issqn_pct: 0.05, ir_pct: 0.048, cofins_pct: 0, pis_pct: 0, csll_pct: 0 };

describe("itemParaGravar", () => {
  it("não leva campos de cálculo em memória (valores_legados) para o banco", () => {
    const calc = calcularItem({ ...base, valores_legados: null }, pct);
    const linha = itemParaGravar(calc as any, "nf-1", 0);
    expect(linha).not.toHaveProperty("valores_legados");
    const legado = calcularItem(
      { ...base, valores_legados: valoresLegadosDoItem({ vlr_va: 0, vlr_vt: 0, vlr_materiais: 0, vlr_mao_obra: 0, vlr_bruto: 100, vlr_liquido: 90 }) },
      pct
    );
    expect(itemParaGravar(legado as any, "nf-1", 0)).not.toHaveProperty("valores_legados");
  });

  it("só grava colunas conhecidas, mais nf, ordem e identificação", () => {
    const linha = itemParaGravar({ ...calcularItem(base, pct), identificacao: "ITEM 3", qualquer_coisa_nova: 1 } as any, "nf-1", 2);
    const permitidas = new Set<string>(["nf_emissao_id", "ordem", "identificacao", ...COLUNAS_ITEM_NF]);
    for (const k of Object.keys(linha)) expect(permitidas.has(k)).toBe(true);
    expect(linha.nf_emissao_id).toBe("nf-1");
    expect(linha.ordem).toBe(3);
    expect(linha.identificacao).toBe("ITEM 3");
    expect(linha.vlr_liquido).toBeGreaterThan(0);
  });

  it("sem identificação, usa 'Item N'", () => {
    expect(itemParaGravar({ ...calcularItem(base, pct) } as any, "nf-1", 0).identificacao).toBe("Item 1");
  });
});

// Cliente de mentira: registra as operações e permite falhar o insert.
function banco(antigos: any[], falhaInsertNovo: boolean) {
  const ops: string[] = [];
  let insercoes = 0;
  const db = {
    from: () => ({
      select: () => ({ eq: async () => ({ data: antigos, error: null }) }),
      delete: () => ({ eq: async () => { ops.push("delete"); return { error: null }; } }),
      insert: async (linhas: any[]) => {
        insercoes += 1;
        ops.push(`insert:${linhas.length}`);
        if (falhaInsertNovo && insercoes === 1) return { error: { message: "coluna inexistente" } };
        return { error: null };
      },
    }),
  };
  return { db, ops };
}

describe("substituirItensNf", () => {
  const novos = [calcularItem(base, pct) as any];

  it("insert ok: apaga os antigos e grava os novos", async () => {
    const { db, ops } = banco([{ id: "a" }], false);
    await substituirItensNf(db, "nf-1", novos);
    expect(ops).toEqual(["delete", "insert:1"]);
  });

  it("insert falha: devolve os itens antigos e propaga o erro (a nota não fica sem itens)", async () => {
    const { db, ops } = banco([{ id: "a" }, { id: "b" }], true);
    await expect(substituirItensNf(db, "nf-1", novos)).rejects.toMatchObject({ message: "coluna inexistente" });
    expect(ops).toEqual(["delete", "insert:1", "insert:2"]);
  });

  it("sem itens novos, só apaga", async () => {
    const { db, ops } = banco([{ id: "a" }], false);
    await substituirItensNf(db, "nf-1", []);
    expect(ops).toEqual(["delete"]);
  });
});
