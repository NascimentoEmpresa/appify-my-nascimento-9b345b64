import { describe, expect, it } from "vitest";
import {
  escalaHoras,
  insightsDashboard,
  linhasExcelDashboard,
  nivelEfetividade,
  percentual,
  quebrarNome,
  rotuloHoras,
  rotuloMes,
  rotuloMotivo,
  seriePorDiaSemana,
  textoVariacao,
} from "@/pages/sistemas/hora-extra/dashboardHoraExtraUtils";
import type { DadosDashboardHoraExtra } from "@/pages/sistemas/hora-extra/types";

describe("rotuloMes", () => {
  it("formata AAAA-MM sem passar por Date (dia 1 em UTC volta um mês)", () => {
    expect(rotuloMes("2026-09")).toBe("Set/2026");
    expect(rotuloMes("2026-01")).toBe("Jan/2026");
    expect(rotuloMes("2026-12")).toBe("Dez/2026");
  });
  it("devolve a entrada quando o mês não é válido", () => {
    expect(rotuloMes("2026-13")).toBe("2026-13");
    expect(rotuloMes("")).toBe("");
  });
});

describe("rotuloHoras", () => {
  it("usa hora cheia quando fecha certo", () => {
    expect(rotuloHoras(0)).toBe("0h");
    expect(rotuloHoras(120)).toBe("2h");
    expect(rotuloHoras(600)).toBe("10h");
  });
  it("mantém os minutos quando não fecha", () => {
    expect(rotuloHoras(150)).toBe("2h30");
  });
});

describe("escalaHoras", () => {
  it("sobra espaço acima da maior barra para o rótulo do valor", () => {
    const ticks = escalaHoras(510, 6); // 8h30
    expect(ticks[ticks.length - 1]).toBeGreaterThan(510);
    expect(ticks.map(rotuloHoras)).toEqual(["0h", "2h", "4h", "6h", "8h", "10h"]);
  });
  it("cresce o eixo quando a maior barra encosta no topo", () => {
    expect(escalaHoras(560, 6).map(rotuloHoras)).toEqual(["0h", "2h", "4h", "6h", "8h", "10h", "12h"]);
  });
  it("não passa do número de divisões pedido", () => {
    expect(escalaHoras(1570, 4).length).toBeLessThanOrEqual(5);
  });
  it("tem piso de 2h para período sem hora extra nenhuma", () => {
    expect(escalaHoras(0, 6)[escalaHoras(0, 6).length - 1]).toBe(120);
  });
});

describe("quebrarNome", () => {
  it("quebra o nome completo em duas linhas sem cortar palavra", () => {
    expect(quebrarNome("Eduardo Jeiel Padilha Monteiro Vaz", 19, 2)).toEqual([
      "Eduardo Jeiel",
      "Padilha Monteiro Vaz",
    ]);
  });
  it("deixa nome curto numa linha só", () => {
    expect(quebrarNome("João Peretti", 19, 2)).toEqual(["João Peretti"]);
  });
  it("estica o limite em vez de cortar quando o nome não cabe", () => {
    const linhas = quebrarNome("Um Nome Muito Muito Muito Comprido Mesmo", 10, 2);
    expect(linhas).toHaveLength(2);
    expect(linhas.join(" ")).toBe("Um Nome Muito Muito Muito Comprido Mesmo");
  });
  it("não quebra palavra maior que o limite", () => {
    expect(quebrarNome("Pneumoultramicroscopico", 8, 2)).toEqual(["Pneumoultramicroscopico"]);
  });
});

describe("textoVariacao", () => {
  it("mostra a subida em verde", () => {
    expect(textoVariacao(12)).toEqual({ texto: "12% em relação ao mês anterior", tom: "alta" });
  });
  it("mostra a queda sem sinal negativo no texto", () => {
    expect(textoVariacao(-33)).toEqual({ texto: "33% em relação ao mês anterior", tom: "baixa" });
  });
  it("sem base de comparação não inventa porcentagem", () => {
    expect(textoVariacao(0).texto).toBe("Sem alteração");
    expect(textoVariacao(null).texto).toBe("Sem alteração");
    expect(textoVariacao(undefined).tom).toBe("neutro");
  });
});

describe("nivelEfetividade", () => {
  it("usa os cortes do desenho aprovado", () => {
    expect(nivelEfetividade(94).label).toBe("Muito alta");
    expect(nivelEfetividade(93).label).toBe("Alta");
    expect(nivelEfetividade(88).label).toBe("Alta");
    expect(nivelEfetividade(87).label).toBe("Boa");
    expect(nivelEfetividade(75).label).toBe("Boa");
    expect(nivelEfetividade(74).label).toBe("Regular");
  });
  it("trata ausência de chamado concluído como Regular, não como erro", () => {
    expect(nivelEfetividade(null).label).toBe("Regular");
  });
});

describe("percentual", () => {
  it("arredonda para inteiro", () => {
    expect(percentual(1100, 1422)).toBe(77);
  });
  it("não divide por zero", () => {
    expect(percentual(10, 0)).toBe(0);
  });
});

describe("rotuloMotivo", () => {
  it("traduz o tipo de solicitação do chamado", () => {
    expect(rotuloMotivo("melhoria")).toBe("Melhoria");
    expect(rotuloMotivo("correcao")).toBe("Correção");
  });
  it("cai em Outro para tipo desconhecido ou vazio", () => {
    expect(rotuloMotivo("")).toBe("Outro");
    expect(rotuloMotivo("inexistente")).toBe("Outro");
  });
});

describe("seriePorDiaSemana", () => {
  it("mostra Seg a Sáb mesmo sem hora extra no dia", () => {
    const serie = seriePorDiaSemana([{ dia: 2, minutos: 510 }]);
    expect(serie.map((d) => d.curto)).toEqual(["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]);
    expect(serie.find((d) => d.curto === "Ter")?.minutos).toBe(510);
    expect(serie.find((d) => d.curto === "Seg")?.minutos).toBe(0);
  });
  it("só acrescenta domingo quando houve hora extra nele", () => {
    const comDomingo = seriePorDiaSemana([{ dia: 7, minutos: 90 }]);
    expect(comDomingo.map((d) => d.curto)).toContain("Dom");
    expect(seriePorDiaSemana([{ dia: 7, minutos: 0 }]).map((d) => d.curto)).not.toContain("Dom");
  });
});

const DADOS: DadosDashboardHoraExtra = {
  valor_hora: 85,
  indicadores: {
    aprovadas_min: 1422,
    aprovadas_variacao: 12,
    realizadas_min: 1295,
    realizadas_variacao: 8,
    pendentes_conclusao: 2,
    pendentes_variacao: -33,
    custo_estimado: 1834.58,
    custo_variacao: 15,
    colaboradores: 4,
    colaboradores_variacao: 0,
    chamados: 24,
    chamados_variacao: 26,
  },
  por_colaborador: [
    { id: "a", nome: "Pablo Flores Santarem", minutos: 510 },
    { id: "b", nome: "Eduardo Jeiel Padilha Monteiro Vaz", minutos: 380 },
    { id: "c", nome: "João Peretti", minutos: 255 },
    { id: "d", nome: "Messias", minutos: 150 },
  ],
  evolucao: [],
  por_motivo: [],
  por_dia_semana: [
    { dia: 1, minutos: 130 },
    { dia: 2, minutos: 510 },
    { dia: 3, minutos: 255 },
  ],
  status: { aprovadas_min: 1100, concluidas_min: 195, pendentes_min: 127, total_min: 1422 },
  efetividade: [
    { id: "a", nome: "Pablo Flores Santarem", qtd: 7, aprovadas_min: 510, realizadas_min: 490, chamados: 9, conclusao_media: 93 },
    { id: "b", nome: "Eduardo Jeiel Padilha Monteiro Vaz", qtd: 5, aprovadas_min: 380, realizadas_min: 355, chamados: 7, conclusao_media: 94 },
    { id: "d", nome: "Messias", qtd: 3, aprovadas_min: 150, realizadas_min: 140, chamados: 0, conclusao_media: 99 },
  ],
  opcoes: { empresas: [], setores: [], colaboradores: [] },
};

describe("insightsDashboard", () => {
  it("mede o peso sobre a HE aprovada do período, não sobre a soma das barras", () => {
    const volume = insightsDashboard(DADOS).find((i) => i.chave === "volume");
    expect(volume?.destaque).toBe("Pablo Flores Santarem");
    expect(volume?.detalhe).toBe("8h30 (36% do total)");
  });
  it("ignora quem não trabalhou chamado na melhor efetividade", () => {
    // Messias tem 99% de média mas nenhum chamado no período: média de
    // nada não é a melhor efetividade da equipe.
    const efetividade = insightsDashboard(DADOS).find((i) => i.chave === "efetividade");
    expect(efetividade?.destaque).toBe("Eduardo Jeiel Padilha Monteiro Vaz");
    expect(efetividade?.detalhe).toBe("94% de conclusão média");
  });
  it("nomeia o dia da semana por extenso", () => {
    const dia = insightsDashboard(DADOS).find((i) => i.chave === "dia");
    expect(dia?.destaque).toBe("Terça-feira");
    expect(dia?.detalhe).toBe("8h30 (36% do total)");
  });
  it("não mostra insight nenhum sem dados", () => {
    expect(insightsDashboard(null)).toEqual([]);
    expect(
      insightsDashboard({ ...DADOS, por_colaborador: [], efetividade: [], por_dia_semana: [] }),
    ).toEqual([]);
  });
});

describe("linhasExcelDashboard", () => {
  it("exporta a tabela de efetividade já formatada", () => {
    expect(linhasExcelDashboard(DADOS.efetividade)[0]).toEqual({
      Colaborador: "Pablo Flores Santarem",
      "Qtd. HEs": 7,
      "Horas aprovadas": "8h30",
      "Horas realizadas": "8h10",
      Chamados: 9,
      "Conclusão média": "93%",
      Efetividade: "Alta",
    });
  });
});
