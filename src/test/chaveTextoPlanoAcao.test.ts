import { describe, it, expect } from "vitest";
import { chaveTextoPlanoAcao } from "@/lib/chaveTextoPlanoAcao";
import { SETOR_RESPONSAVEL_MAP, normalizeSetorNome } from "@/data/planoAcaoSetorResponsavel";
import {
  COMITES_FILTRO, SETORES_FILTRO, STATUS_NAO_CONCLUIDAS, STATUS_CONCLUIDOS, STATUS_ORDEM,
} from "@/types/planoAcao";

// SIS-2026-0612: casa a grafia crua gravada numa ação com a opção de filtro
// canônica (busca pelo rótulo exato que a presidência fixou).
const valorPorRotulo = (opts: { value: string; label: string }[], rotulo: string) =>
  opts.find((o) => o.label === rotulo)!.value;

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

describe("filtros canônicos de Comitê/Setor (SIS-2026-0612)", () => {
  it("colapsa as formas longas de comitê na opção curta canônica", () => {
    const esperado = (rotulo: string) => valorPorRotulo(COMITES_FILTRO, rotulo);
    expect(chaveTextoPlanoAcao("Comitê Administrativo")).toBe(esperado("Administrativo"));
    expect(chaveTextoPlanoAcao("Comitê de Controladoria")).toBe(esperado("Controladoria"));
    expect(chaveTextoPlanoAcao("Comitê Operacional")).toBe(esperado("Operacional"));
    expect(chaveTextoPlanoAcao("Administrativo")).toBe(esperado("Administrativo"));
  });

  it("casa as grafias cruas de setor com a opção canônica", () => {
    const esperado = (rotulo: string) => valorPorRotulo(SETORES_FILTRO, rotulo);
    expect(chaveTextoPlanoAcao("Compras")).toBe(esperado("SUPLY"));
    expect(chaveTextoPlanoAcao("FINANCEIRO")).toBe(esperado("FINANCEIRO"));
    expect(chaveTextoPlanoAcao("Financeiro")).toBe(esperado("FINANCEIRO"));
    expect(chaveTextoPlanoAcao("Diretoria Operacional")).toBe(esperado("DIRETOR OPERACIONAL"));
    expect(chaveTextoPlanoAcao("DIRETOR OPERACIONAL")).toBe(esperado("DIRETOR OPERACIONAL"));
    expect(chaveTextoPlanoAcao("Licitação")).toBe(esperado("LICITAÇÃO"));
  });

  it("não gera value duplicado dentro de cada lista fixa", () => {
    const uniq = (opts: { value: string }[]) => new Set(opts.map((o) => o.value)).size;
    expect(uniq(COMITES_FILTRO)).toBe(COMITES_FILTRO.length);
    expect(uniq(SETORES_FILTRO)).toBe(SETORES_FILTRO.length);
  });
});

describe("STATUS_NAO_CONCLUIDAS (SIS-2026-0612)", () => {
  it("exclui as duas concluídas e mantém cancelada", () => {
    for (const s of STATUS_CONCLUIDOS) expect(STATUS_NAO_CONCLUIDAS).not.toContain(s);
    expect(STATUS_NAO_CONCLUIDAS).toContain("cancelada");
    expect(STATUS_NAO_CONCLUIDAS).toHaveLength(STATUS_ORDEM.length - STATUS_CONCLUIDOS.length);
  });
});

describe("SETOR_RESPONSAVEL_MAP com a chave nova", () => {
  it("acha o responsável pelas grafias alternativas do setor", () => {
    expect(SETOR_RESPONSAVEL_MAP[normalizeSetorNome("Diretor Adm")]?.nome).toBe("fernanda maldaner");
    expect(SETOR_RESPONSAVEL_MAP[normalizeSetorNome("Licitações")]?.nome).toBe("lucas de jesus silva");
    expect(SETOR_RESPONSAVEL_MAP[normalizeSetorNome("JURÍDICO")]?.nome).toBe("natalia taborda");
  });
});
