import { describe, expect, it } from "vitest";
import { blocosDeContratos, ondeAgir, pctAdmissoes, tons, type DadosRecPainelTv } from "@/lib/tv/recPainelTv";
import { paginasDoRelatorio } from "@/lib/tv/relatorioTv";

// TV › Recrutamento e Seleção (11/11/2026). Dados fictícios.

const c = (i: number) => ({ contrato: `CONTRATO ${i}`, cidade: "CIDADE", solicitadas: 10 - i, preenchimento: 5, atrasadas: i % 2, risco: 0, mais_antiga: 20 });
const base = (): DadosRecPainelTv => ({
  vagas: { prazo_dias: 15, abertas: 40, contratos: 7, cidades: 3, em_preenchimento: 30, acima_prazo: 3, risco: 0, por_status: [], por_contrato: [1, 2, 3, 4, 5, 6, 7].map(c) },
  admissoes: { previstas: 20, concluidas: 19, pendentes_por_contrato: [] },
  desistencias: { dias: 30, total: 12, por_motivo: [{ motivo: "Salário e benefícios", qtd: 7 }, { motivo: "Outros", qtd: 5 }] },
});

describe("TV Recrutamento e Seleção", () => {
  it("os contratos giram em blocos de 4", () => {
    expect(blocosDeContratos(base().vagas.por_contrato).map((b) => b.length)).toEqual([4, 3]);
    expect(blocosDeContratos([])).toEqual([[]]);
  });

  it("ruim só quando é verdadeiro", () => {
    expect(tons(base())).toEqual({ risco: "bom", abertas: "neutro", prazo: "bom", admissoes: "bom", desistencias: "neutro" });
    const ruim = base();
    ruim.vagas.risco = 4; ruim.vagas.acima_prazo = 30; ruim.admissoes.concluidas = 10;
    expect(tons(ruim)).toMatchObject({ risco: "critico", prazo: "critico", admissoes: "critico" });
  });

  it("admissões: % só com admissão prevista no mês", () => {
    expect(pctAdmissoes(base().admissoes)).toBe(95);
    expect(pctAdmissoes({ previstas: 0, concluidas: 0, pendentes_por_contrato: [] })).toBeNull();
  });

  it("onde agir: só o que tem o que fazer", () => {
    expect(ondeAgir(base()).map((a) => a.texto)).toEqual(["Destravar processos em atraso", "Concluir admissões previstas", "Entender as desistências"]);
  });

  it("o item da playlist é uma página só", () => {
    expect(paginasDoRelatorio({ ...base(), tipo: "rec-painel", contrato: null })).toHaveLength(1);
  });
});
