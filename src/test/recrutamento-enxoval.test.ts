import { describe, expect, it } from "vitest";
import { NAO_PRECISA, faltandoTamanho, resumoLivre, type ItemEnxoval } from "@/lib/recrutamento/enxoval";

const item = (id: string, nome: string, grade: string[] = [], tipo = "uniforme"): ItemEnxoval => ({ item_id: id, nome, tipo, grade, tamanho: null });
const ITENS = [
  item("1", "CAMISETA MESCLA AZUL (MC)", ["P", "M", "G", "GG", "EGG", "EXGG"]),
  item("2", "BABUCHE PRETO", ["33", "34", "35", "36"]),
  item("3", "OCULOS DE PROTEÇÃO INCOLOR", [], "epi"),
  item("4", "JALECO - CINZA"),
];

describe("faltandoTamanho (enxoval da admissão)", () => {
  it("item com grade e uniforme sem grade faltam; EPI sem grade nunca falta", () => {
    expect(faltandoTamanho(ITENS, {})).toEqual(["CAMISETA MESCLA AZUL (MC)", "BABUCHE PRETO", "JALECO - CINZA"]);
    expect(faltandoTamanho(ITENS, { "1": "M", "2": "35", "4": "G" })).toEqual([]);
  });
  it("'Não precisa' dispensa o item", () => {
    expect(faltandoTamanho(ITENS, { "1": "M", "2": NAO_PRECISA, "4": NAO_PRECISA })).toEqual([]);
  });
  // 19/10/2026: o Catálogo pode não ter a opção — o Recrutamento escreve.
  it("tamanho escrito fora da grade vale", () => {
    expect(faltandoTamanho(ITENS, { "1": "XXL", "2": "35", "4": "manga longa G" })).toEqual([]);
  });
  it("sem tamanho passa só com observação do item", () => {
    expect(faltandoTamanho(ITENS, { "1": "M", "2": "35" }, { "4": "  " })).toEqual(["JALECO - CINZA"]);
    expect(faltandoTamanho(ITENS, { "1": "M", "2": "35" }, { "4": "candidata ainda vai provar" })).toEqual([]);
  });
  it("resumo do texto livre diz que a função não tem enxoval", () => {
    expect(resumoLivre("SERVENTE", " botina 42 ")).toBe("Função SERVENTE sem enxoval no Catálogo. Materiais informados pelo Recrutamento:\nbotina 42");
  });
});
