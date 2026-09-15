import { describe, it, expect } from "vitest";
import { chaveTextoPlanoAcao } from "@/lib/chaveTextoPlanoAcao";
import { SETOR_RESPONSAVEL_MAP, normalizeSetorNome } from "@/data/planoAcaoSetorResponsavel";

describe("chaveTextoPlanoAcao", () => {
  it("junta variações de caixa e acento", () => {
    expect(chaveTextoPlanoAcao("Jurídico")).toBe(chaveTextoPlanoAcao("JURIDICO"));
    expect(chaveTextoPlanoAcao("  Presidência ")).toBe("presidencia");
  });

  it("junta plural x singular e abreviação x nome completo", () => {
    expect(chaveTextoPlanoAcao("Licitações")).toBe(chaveTextoPlanoAcao("LICITACAO"));
    expect(chaveTextoPlanoAcao("Diretor Adm")).toBe(chaveTextoPlanoAcao("DIRETOR ADMINISTRATIVO"));
    expect(chaveTextoPlanoAcao("Diretoria Adm.")).toBe(chaveTextoPlanoAcao("Diretoria Administrativa"));
  });

  it("é idempotente (valor já normalizado na URL continua batendo)", () => {
    for (const s of ["Jurídico", "Licitações", "Diretor Adm", "Comitê Diretivo"]) {
      const k = chaveTextoPlanoAcao(s);
      expect(chaveTextoPlanoAcao(k)).toBe(k);
    }
  });

  it("vazio vira string vazia", () => {
    expect(chaveTextoPlanoAcao(null)).toBe("");
    expect(chaveTextoPlanoAcao("   ")).toBe("");
  });
});

describe("SETOR_RESPONSAVEL_MAP com a chave nova", () => {
  it("acha o responsável pelas grafias alternativas do setor", () => {
    expect(SETOR_RESPONSAVEL_MAP[normalizeSetorNome("Diretor Adm")]?.nome).toBe("fernanda maldaner");
    expect(SETOR_RESPONSAVEL_MAP[normalizeSetorNome("Licitações")]?.nome).toBe("lucas de jesus silva");
    expect(SETOR_RESPONSAVEL_MAP[normalizeSetorNome("JURÍDICO")]?.nome).toBe("natalia taborda");
  });
});
