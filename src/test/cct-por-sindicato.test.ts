import { describe, expect, it } from "vitest";
import { chaveSindicato, cctAutomaticaDoPosto, type ConvencaoParaVinculo } from "@/lib/licitacoes/cctPorSindicato";

// SIS-2026-0933: CCT do posto automática pelo nome do sindicato (Planilha de Custo).

const cct = (p: Partial<ConvencaoParaVinculo> & { id: string }): ConvencaoParaVinculo => ({
  tipo: "cct", sindicato: "SEEAC/SINDASSEIO RS", vigencia_inicio: "2026-01-01", vigencia_fim: "2026-12-31",
  contrato_id: null, situacao: "completo", updated_at: "2026-11-01T00:00:00Z", ...p,
});

describe("chaveSindicato", () => {
  it("ignora maiúsculas, acentos e espaços extras", () => {
    expect(chaveSindicato("seeac/sindasseio rs")).toBe("SEEAC/SINDASSEIO RS");
    expect(chaveSindicato("  SEEAC / SINDASSEIO   RS ")).toBe("SEEAC/SINDASSEIO RS");
    expect(chaveSindicato("Sindicato dos Trabalhadores - Conservação")).toBe("SINDICATO DOS TRABALHADORES-CONSERVACAO");
    expect(chaveSindicato(null)).toBe("");
  });
});

describe("cctAutomaticaDoPosto", () => {
  const posto = { sindicato: "SEEAC/SINDASSEIO RS", data_vigencia: "2026-09-24", contrato_id: "ct-bento", servico: "ADMINISTRATIVO" };

  it("liga pelo nome do sindicato, mesmo com caixa/acento diferente", () => {
    const r = cctAutomaticaDoPosto(posto, [cct({ id: "a", sindicato: "seeac/sindasseio rs" })]);
    expect(r?.convencao.id).toBe("a");
    expect(r?.foraDaVigencia).toBe(false);
  });

  it("sem sindicato no posto ou sem CCT com o nome: nada", () => {
    expect(cctAutomaticaDoPosto({ ...posto, sindicato: " " }, [cct({ id: "a" })])).toBeNull();
    expect(cctAutomaticaDoPosto(posto, [cct({ id: "a", sindicato: "SINECARGA/SETCERGS RS" })])).toBeNull();
  });

  it("decreto municipal nunca entra", () => {
    expect(cctAutomaticaDoPosto(posto, [cct({ id: "d", tipo: "decreto" })])).toBeNull();
  });

  it("prefere a CCT cuja vigência cobre a data do posto", () => {
    const r = cctAutomaticaDoPosto(posto, [
      cct({ id: "2025", vigencia_inicio: "2025-01-01", vigencia_fim: "2025-12-31" }),
      cct({ id: "2026" }),
      cct({ id: "2027", vigencia_inicio: "2027-01-01", vigencia_fim: "2027-12-31" }),
    ]);
    expect(r?.convencao.id).toBe("2026");
  });

  it("nenhuma cobre: a de período mais próximo, marcada fora da vigência", () => {
    const r = cctAutomaticaDoPosto({ ...posto, data_vigencia: "2024-06-01" }, [
      cct({ id: "2025", vigencia_inicio: "2025-01-01", vigencia_fim: "2025-12-31" }),
      cct({ id: "2026" }),
    ]);
    expect(r?.convencao.id).toBe("2025");
    expect(r?.foraDaVigencia).toBe(true);
  });

  it("posto sem data: a de vigência mais recente, sem aviso", () => {
    const r = cctAutomaticaDoPosto({ ...posto, data_vigencia: null }, [
      cct({ id: "2025", vigencia_inicio: "2025-01-01", vigencia_fim: "2025-12-31" }),
      cct({ id: "2026" }),
    ]);
    expect(r?.convencao.id).toBe("2026");
    expect(r?.foraDaVigencia).toBe(false);
  });

  it("mesmo contrato > sem contrato > de outro contrato", () => {
    const lista = [cct({ id: "outro", contrato_id: "ct-ceitec" }), cct({ id: "geral" }), cct({ id: "meu", contrato_id: "ct-bento" })];
    expect(cctAutomaticaDoPosto(posto, lista)?.convencao.id).toBe("meu");
    expect(cctAutomaticaDoPosto({ ...posto, contrato_id: "ct-x" }, lista)?.convencao.id).toBe("geral");
    expect(cctAutomaticaDoPosto({ ...posto, contrato_id: null }, lista)?.convencao.id).toBe("geral");
  });

  it("mesmo sindicato, categorias diferentes: desempata pelo serviço do posto", () => {
    const lista = [
      cct({ id: "limpeza", categoria_profissional: "LIMPEZA E CONSERVAÇÃO" }),
      cct({ id: "adm", categoria_profissional: "Administrativo" }),
    ];
    expect(cctAutomaticaDoPosto(posto, lista)?.convencao.id).toBe("adm");
    expect(cctAutomaticaDoPosto({ ...posto, servico: "limpeza e conservacao" }, lista)?.convencao.id).toBe("limpeza");
  });

  it("empate total: completa antes da pendente, depois a atualizada por último", () => {
    expect(cctAutomaticaDoPosto(posto, [cct({ id: "p", situacao: "pendente", updated_at: "2026-11-10" }), cct({ id: "c" })])?.convencao.id).toBe("c");
    expect(cctAutomaticaDoPosto(posto, [cct({ id: "velha" }), cct({ id: "nova", updated_at: "2026-11-15" })])?.convencao.id).toBe("nova");
  });
});
