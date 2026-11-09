import { describe, expect, it } from "vitest";
import {
  fatiasSituacao, montarCards, rotuloCompetencia, variacaoPP, variacaoPct, variacaoQtd,
  type DadosPainelExecutivo,
} from "@/lib/operacional/painelExecutivo";

const base: DadosPainelExecutivo = {
  competencia: "2026-05",
  ultima_dre: "2026-05",
  competencias: ["2026-05"],
  dre: { receita: 200, custo: 150, lucro: 50, margem: 25 },
  dre_anterior: { receita: 100, custo: 80, lucro: 20, margem: 20 },
  nf: { qtd: 3, recebido: 90, recebido_ant: 100, saldo: 60, saldo_ant: 50, vencido_90: 10, vencido_90_ant: 20 },
  serie: [],
  situacao: { saudavel: 6, atencao: 3, critico: 1 },
  critico_anterior: 3,
};

const card = (d: DadosPainelExecutivo, chave: string) => montarCards(d).find((c) => c.chave === chave)!;

describe("Painel Executivo: número só se for verdadeiro", () => {
  it("mês depois do fim do DRE fica sem número e diz até quando há DRE", () => {
    const d = { ...base, competencia: "2026-08", dre: null, dre_anterior: null, situacao: null, critico_anterior: null };
    for (const chave of ["receita", "lucro", "margem", "criticos"]) {
      expect(card(d, chave).valor).toBeNull();
      expect(card(d, chave).variacao).toBeNull();
      expect(card(d, chave).aviso).toBe("DRE disponível até Mai/2026");
    }
  });

  it("os cards de NF continuam valendo sem DRE", () => {
    const d = { ...base, dre: null, situacao: null };
    expect(card(d, "saldo").valor).not.toBeNull();
  });

  it("% faturado no prazo nunca tem número", () => {
    expect(card(base, "no_prazo").medida).toBe("sem_fonte");
    expect(card(base, "no_prazo").valor).toBeNull();
  });

  it("sem nenhuma NF concluída não mostra R$ 0,00", () => {
    const d = { ...base, nf: { ...base.nf, qtd: 0, recebido: 0, saldo: 0, vencido_90: 0 } };
    for (const chave of ["recebido", "saldo", "vencido"]) expect(card(d, chave).valor).toBeNull();
  });

  it("zero crítico é um número verdadeiro, não ausência", () => {
    expect(card({ ...base, situacao: { saudavel: 1, atencao: 0, critico: 0 } }, "criticos").valor).toBe("0");
  });
});

describe("Painel Executivo: variação contra o mês anterior", () => {
  it("receita maior é melhor; saldo maior é pior", () => {
    expect(variacaoPct(200, 100, true)).toMatchObject({ texto: "+100,0%", seta: "sobe", sentido: "melhor" });
    expect(card(base, "saldo").variacao).toMatchObject({ seta: "sobe", sentido: "pior" });
    expect(card(base, "vencido").variacao).toMatchObject({ seta: "desce", sentido: "melhor" });
  });

  it("sem base não inventa percentual", () => {
    expect(variacaoPct(10, 0, true)).toBeNull();
    expect(variacaoPct(10, null, true)).toBeNull();
  });

  it("base negativa não inverte a leitura", () => {
    expect(variacaoPct(-50, -100, true)).toMatchObject({ seta: "sobe", sentido: "melhor" });
  });

  it("margem varia em pontos percentuais", () => {
    expect(variacaoPP(25, 20)).toMatchObject({ texto: "+5,0 p.p.", sentido: "melhor" });
  });

  it("menos contrato crítico é melhor", () => {
    expect(variacaoQtd(1, 3)).toMatchObject({ texto: "-2", seta: "desce", sentido: "melhor" });
    expect(variacaoQtd(2, 2)).toMatchObject({ seta: "igual", sentido: "neutro" });
  });
});

describe("Painel Executivo: rosca e rótulos", () => {
  it("percentual sobre os contratos classificados", () => {
    const { total, fatias } = fatiasSituacao(base.situacao);
    expect(total).toBe(10);
    expect(fatias.map((f) => f.pct)).toEqual([60, 30, 10]);
  });

  it("sem classificação não divide por zero", () => {
    const { total, fatias } = fatiasSituacao(null);
    expect(total).toBe(0);
    expect(fatias.every((f) => f.pct === 0)).toBe(true);
  });

  it("competência em português", () => {
    expect(rotuloCompetencia("2026-05")).toBe("Mai/2026");
  });
});
