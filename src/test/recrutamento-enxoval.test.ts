import { describe, expect, it } from "vitest";
import { NAO_PRECISA, faltandoTamanho, resumoLivre, type ItemEnxoval } from "@/lib/recrutamento/enxoval";

const item = (id: string, nome: string, grade: string[] = []): ItemEnxoval => ({ item_id: id, nome, tipo: "uniforme", grade, tamanho: null });
const ITENS = [
  item("1", "CAMISETA MESCLA AZUL (MC)", ["P", "M", "G", "GG", "EGG", "EXGG"]),
  item("2", "BABUCHE PRETO", ["33", "34", "35", "36"]),
  item("3", "OCULOS DE PROTEÇÃO INCOLOR"),
];

describe("faltandoTamanho (enxoval da admissão)", () => {
  it("item com grade sem tamanho falta; óculos (sem grade) nunca falta", () => {
    expect(faltandoTamanho(ITENS, {})).toEqual(["CAMISETA MESCLA AZUL (MC)", "BABUCHE PRETO"]);
    expect(faltandoTamanho(ITENS, { "1": "M", "2": "35" })).toEqual([]);
  });
  it("'Não precisa' dispensa o item", () => {
    expect(faltandoTamanho(ITENS, { "1": "M", "2": NAO_PRECISA })).toEqual([]);
  });
  it("tamanho fora da grade do Catálogo conta como faltando", () => {
    expect(faltandoTamanho(ITENS, { "1": "XXL", "2": "35" })).toEqual(["CAMISETA MESCLA AZUL (MC)"]);
  });
  it("resumo do texto livre diz que a função não tem enxoval", () => {
    expect(resumoLivre("SERVENTE", " botina 42 ")).toBe("Função SERVENTE sem enxoval no Catálogo. Materiais informados pelo Recrutamento:\nbotina 42");
  });
});
