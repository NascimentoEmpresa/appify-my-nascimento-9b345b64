import { describe, expect, it } from "vitest";
import { ETAPA_KANBAN, dicaDaEtapa, statusDetalhadoVaga, vagaTemEtapa, type EtapaVaga } from "@/lib/recrutamento/statusDetalhado";

// Status detalhado da vaga (08/10/2026, mig 20261008000008): "quando o
// recrutamento move o kanban deve ficar Recrutamento: TRIAGEM, e por assim
// vai, de acordo com os status do kanban, e vai mudando de cor".

const etapa = (e: string, extra: Partial<EtapaVaga> = {}): EtapaVaga => ({
  vaga_id: 1, etapa: e, candidatos: 3, por_etapa: { ENTRADA: 2, [e]: 1 }, atualizado_em: "2026-10-06T15:00:00Z", ...extra,
});

describe("status detalhado da vaga pela etapa do kanban", () => {
  it("vaga com candidato no kanban: '<Área>: <ETAPA>' na cor da coluna", () => {
    const t = statusDetalhadoVaga("Vaga aberta - Seleção de Currículos", etapa("TRIAGEM"));
    expect(t).toMatchObject({ texto: "Recrutamento: TRIAGEM", detalhado: true, cor: "#3b82f6", tinta: "#2563eb" });
    expect(statusDetalhadoVaga("Em análise jurídica", etapa("JURÍDICO")).texto).toBe("Jurídico: ANÁLISE JURÍDICA");
    expect(statusDetalhadoVaga("Aguardando SST e Compras", etapa("SST + COMPRAS")).texto).toBe("SST + Compras: EXAME E EPIs");
    expect(statusDetalhadoVaga("Aguardando SST e Compras", etapa("ADMISSÃO")).texto).toBe("Recrutamento: ADMISSÃO");
    expect(statusDetalhadoVaga("Entrevista com Gestor", etapa("ENTREVISTA GESTOR")).texto).toBe("Recrutamento: ENTREVISTA GESTOR");
  });

  it("toda coluna do kanban (menos Reprovado) tem área, texto e cor", () => {
    for (const e of ["ENTRADA", "TRIAGEM", "JURÍDICO", "ENTREVISTA", "ENTREVISTA GESTOR", "APROVADO", "DOCUMENTAÇÃO", "SST + COMPRAS", "ADMISSÃO"]) {
      expect(ETAPA_KANBAN[e]?.cor).toMatch(/^#[0-9a-f]{6}$/);
      expect(statusDetalhadoVaga("Vaga aberta - Seleção de Currículos", etapa(e)).detalhado).toBe(true);
    }
    // Cada etapa muda de cor.
    expect(new Set(Object.values(ETAPA_KANBAN).map((a) => a.cor)).size).toBe(Object.keys(ETAPA_KANBAN).length);
  });

  it("Pendente Recrutamento: com candidato movido vira a etapa; sem candidato fica como está", () => {
    expect(statusDetalhadoVaga("Pendente Recrutamento", etapa("TRIAGEM")).texto).toBe("Recrutamento: TRIAGEM");
    expect(statusDetalhadoVaga("Pendente Recrutamento", null)).toEqual({ texto: "Pendente Recrutamento", detalhado: false });
  });

  it("vaga aberta sem candidato: Recrutamento: SELEÇÃO DE CURRÍCULOS", () => {
    expect(statusDetalhadoVaga("Vaga aberta - Seleção de Currículos", null)).toMatchObject({ texto: "Recrutamento: SELEÇÃO DE CURRÍCULOS", detalhado: true });
  });

  it("encerrada e fila de aprovação: o status de sempre, mesmo com candidato", () => {
    expect(statusDetalhadoVaga("Contratado", etapa("ADMISSÃO"))).toEqual({ texto: "Contratado", detalhado: false });
    expect(statusDetalhadoVaga("Concluído", etapa("ADMISSÃO")).detalhado).toBe(false);
    expect(statusDetalhadoVaga("Concluída", etapa("ADMISSÃO")).detalhado).toBe(false);
    expect(statusDetalhadoVaga("Reprovada", etapa("ENTRADA")).texto).toBe("Reprovada");
    expect(statusDetalhadoVaga("Cancelada", etapa("ENTRADA")).detalhado).toBe(false);
    // "Pendente Analista" continua com o rótulo da tela (Pendente Operacional).
    expect(statusDetalhadoVaga("Pendente Analista", null)).toEqual({ texto: "Pendente Operacional", detalhado: false });
    expect(statusDetalhadoVaga("Pendente Diretoria", null).detalhado).toBe(false);
    expect(vagaTemEtapa("Pendente Analista")).toBe(false);
    expect(vagaTemEtapa("Contratado")).toBe(false);
    expect(vagaTemEtapa("Vaga aberta - Seleção de Currículos")).toBe(true);
    expect(vagaTemEtapa("Pendente Recrutamento")).toBe(true);
    expect(vagaTemEtapa(null)).toBe(false);
  });

  it("etapa desconhecida não inventa selo: cai no status", () => {
    expect(statusDetalhadoVaga("Entrevista e Avaliação", etapa("XYZ"))).toEqual({ texto: "Entrevista e Avaliação", detalhado: false });
  });

  it("a dica conta os candidatos por etapa, na ordem do kanban, e o desde", () => {
    const d = dicaDaEtapa(etapa("TRIAGEM", { candidatos: 6, por_etapa: { TRIAGEM: 1, ENTRADA: 5 } }));
    expect(d).toMatch(/^Candidato mais adiantado: TRIAGEM desde \d{2}\/10 · 6 no processo \(ENTRADA 5, TRIAGEM 1\)$/);
  });
});
