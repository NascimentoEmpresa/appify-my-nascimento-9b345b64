import { describe, expect, it } from "vitest";
import {
  LinhaFaltaDias,
  aplicarFaltasNosItens,
  itensComFaltasCalculadas,
  linhaFaltaVazia,
  linhasParaGravar,
  reindexarLinhasAoRemoverItem,
  totalFaltasLinhas,
  valorFaltasPorDias,
} from "@/pages/financeiro/nf-emissao/faltasPorDias";
import { preencherVariaveis, ContextoDescricao } from "@/pages/financeiro/nf-emissao/descricaoVariaveis";

const linha = (o: Partial<LinhaFaltaDias> = {}): LinhaFaltaDias => ({ item: 0, posto: "AUX. LIMPEZA 44H 5X2", valor_posto: 5739.97, dias: 2, ...o });

describe("faltas por dias na nota (SIS-2026-0633, Veranópolis)", () => {
  it("reproduz a planilha: posto R$ 5.739,97 × 2 dias ÷ 30 = R$ 382,66", () => {
    expect(valorFaltasPorDias(5739.97, 2)).toBe(382.66);
  });

  it("sem posto ou sem dias não inventa valor", () => {
    expect(valorFaltasPorDias(null, 2)).toBe(0);
    expect(valorFaltasPorDias(5739.97, 0)).toBe(0);
  });

  it("soma as linhas ligadas a cada item e deixa os demais como estão", () => {
    const itens = [{ faltas: 0 }, { faltas: 0 }, { faltas: 77 }];
    const linhas = [linha({ item: 0 }), linha({ item: 0, dias: 1 }), linha({ item: 1, dias: 3 })];
    const r = aplicarFaltasNosItens(itens, [], linhas);
    expect(r[0].faltas).toBe(573.99); // 382,66 + 191,33 (cada linha arredonda)
    expect(r[1].faltas).toBe(574.0); // 3 dias
    expect(r[2].faltas).toBe(77); // nunca teve linha: valor digitado preservado
  });

  it("desligar a última linha de um item zera as faltas dele", () => {
    const antes = [linha({ item: 1 })];
    const depois = [linha({ item: 0 })];
    const r = aplicarFaltasNosItens([{ faltas: 0 }, { faltas: 382.66 }], antes, depois);
    expect(r[1].faltas).toBe(0);
    expect(r[0].faltas).toBe(382.66);
  });

  it("itens com linha ligada ficam com o campo calculado", () => {
    expect([...itensComFaltasCalculadas([linha({ item: 2 }), linha({ item: null })])]).toEqual([2]);
  });

  it("remover um item reindexa as linhas", () => {
    const r = reindexarLinhasAoRemoverItem([linha({ item: 0 }), linha({ item: 1 }), linha({ item: 2 })], 1);
    expect(r.map((l) => l.item)).toEqual([0, null, 1]);
  });

  it("total e gravação ignoram linhas em branco", () => {
    expect(totalFaltasLinhas([linha(), linha({ dias: 1 })])).toBe(573.99);
    expect(linhasParaGravar([linhaFaltaVazia(0)])).toBeNull();
    expect(linhasParaGravar([linhaFaltaVazia(0), linha()])).toHaveLength(1);
  });

  it("variável {faltas_por_local} gera uma linha por local com falta", () => {
    const item = (o: Record<string, unknown>) =>
      ({
        valor_contrato_exec: 0, vlr_va: 0, vlr_vt: 0, vlr_materiais: 0, faltas: 0, posto_nao_implementado: 0,
        multas: 0, glosas: 0, outros_descontos: 0, multas_pos_emissao: 0, glosas_pos_emissao: 0,
        outros_descontos_pos_emissao: 0, vlr_bruto: 0, vlr_mao_obra: 0, inss: 0, total_descontos: 0, ...o,
      }) as ContextoDescricao["itens"][number];
    const ctx: ContextoDescricao = {
      competencia: "2026-08-01",
      itens: [
        item({ identificacao: "ANITA", valor_contrato_exec: 17219.91, faltas: 382.66 }),
        item({ identificacao: "IRMÃ LAURA", valor_contrato_exec: 17219.91 }),
      ],
    };
    const r = preencherVariaveis("ESCOLAS:\n{faltas_por_local}", ctx);
    expect(r.split("\n")).toHaveLength(2);
    expect(r).toContain("ANITA (R$");
    expect(r).toContain("DE FALTAS");
    expect(r).not.toContain("LAURA");
    expect(preencherVariaveis("FALTAS:\n{faltas_por_local}\nFIM", { ...ctx, itens: [item({})] })).toBe("FALTAS:\nFIM");
  });
});
