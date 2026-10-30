import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  TickCategoria,
  TickCategoriaCentralizado,
  TickCategoriaInclinado,
  abreviarRotulo,
  formatarEixoMoeda,
} from "@/components/suprimentos/dashboard/PainelBase";

/**
 * Rótulos de eixo do Dashboard de Suprimentos.
 *
 * Os nomes usados aqui são os que aparecem de verdade nas telas — foram
 * tirados do dashboard em produção, onde os rótulos longos estavam quebrando
 * em duas linhas e montando uns sobre os outros.
 */

describe("abreviarRotulo — rótulo de categoria em uma linha", () => {
  it("devolve o nome inteiro quando ele cabe", () => {
    expect(abreviarRotulo("TJRS - 023/2025", 32)).toBe("TJRS - 023/2025");
    expect(abreviarRotulo("UFFS - 041/2021", 32)).toBe("UFFS - 041/2021");
  });

  it("preserva o número do contrato, que é o que distingue os nomes", () => {
    // Os três começam igual: cortar o fim transformaria os três no mesmo
    // rótulo e o gráfico passaria a mentir sobre qual contrato é qual.
    const nomes = [
      "UFRGS - LIMPEZA GERAL - 047/2022",
      "UFRGS - LIMPEZA - 020/2022",
      "UFRGS - JARDINAGEM - 062/2025",
    ];
    const curtos = nomes.map((n) => abreviarRotulo(n, 22));

    expect(new Set(curtos).size).toBe(3);
    expect(curtos[0]).toContain("047/2022");
    expect(curtos[1]).toContain("020/2022");
    expect(curtos[2]).toContain("062/2025");
  });

  it("respeita o limite de caracteres pedido", () => {
    const longos = [
      "VERANÓPOLIS RECEP EMERGENCIAL - 151/2026",
      "SECRETARIA DA CULTURA POA - PORTARIA - 88123/2024",
      "BENTO GONÇALVES LIMPEZA - 048/2026",
      "PREF POA SMS RECEPÇÃO - 98672/2025",
      "IRGA APOIO ADMINISTRATIVO - 049/2026",
    ];
    for (const nome of longos) {
      for (const limite of [18, 22, 24, 32]) {
        expect(abreviarRotulo(nome, limite).length).toBeLessThanOrEqual(limite);
      }
    }
  });

  it("lida com numeração de contrato em outros formatos", () => {
    expect(abreviarRotulo("EMBRAPA CLIMA TEMPERADO - 2026/02", 22)).toContain("2026/02");
    expect(abreviarRotulo("PREF POA SMS RECEPÇÃO - 98672/2025", 24)).toContain("98672/2025");
  });

  it("cai no corte simples quando não há número para preservar", () => {
    const curto = abreviarRotulo("GIOVANNA DALBOSCO VARGUES", 20);
    expect(curto.length).toBeLessThanOrEqual(20);
    expect(curto.endsWith("…")).toBe(true);
    expect(curto.startsWith("GIOVANNA")).toBe(true);
  });

  it("não deixa espaço nem hífen solto antes da elipse", () => {
    expect(abreviarRotulo("UFRGS - LIMPEZA GERAL - 047/2022", 22)).not.toMatch(/[\s-]…/);
    expect(abreviarRotulo("NATANA MARQUES DE AZEREDO", 14)).not.toMatch(/[\s-]…/);
  });

  it("aguenta entrada vazia, nula e com espaço sobrando", () => {
    expect(abreviarRotulo("", 10)).toBe("");
    expect(abreviarRotulo(undefined as unknown as string, 10)).toBe("");
    expect(abreviarRotulo("  UFFS   CERRO   LARGO  ", 40)).toBe("UFFS CERRO LARGO");
  });
});

describe("tick de categoria — uma linha só, que é o que mata a sobreposição", () => {
  function desenhar(no: React.ReactElement) {
    const { container } = render(<svg>{no}</svg>);
    return container.querySelector("text") as SVGTextElement;
  }

  it("emite UM <text> sem nenhuma quebra em tspan", () => {
    // A causa da sobreposição era o tick padrão do recharts quebrar o rótulo
    // em vários <tspan>; com muitas categorias numa altura fixa, as linhas de
    // um rótulo invadiam o de cima. Um <text> sem tspan não tem como colidir.
    const texto = desenhar(
      <TickCategoria x={100} y={50} payload={{ value: "UFRGS - LIMPEZA GERAL - 047/2022" }} maximo={22} />,
    );
    expect(texto).toBeTruthy();
    expect(texto.querySelectorAll("tspan").length).toBe(0);
    expect(texto.textContent).not.toContain("\n");
  });

  it("guarda o nome completo no title, para nada se perder no corte", () => {
    const completo = "SECRETARIA DA CULTURA POA - PORTARIA - 88123/2024";
    const texto = desenhar(<TickCategoria x={10} y={10} payload={{ value: completo }} maximo={20} />);
    expect(texto.querySelector("title")?.textContent).toBe(completo);
    expect(texto.textContent).toContain(completo);
  });

  it("a versão inclinada também sai em uma linha e com o giro aplicado", () => {
    const texto = desenhar(
      <TickCategoriaInclinado x={80} y={40} payload={{ value: "POLÍCIA CIVIL RS LIMPEZA - 066/2026" }} maximo={24} />,
    );
    expect(texto.querySelectorAll("tspan").length).toBe(0);
    expect(texto.getAttribute("transform")).toBe("rotate(-35, 80, 40)");
    expect(texto.getAttribute("text-anchor")).toBe("end");
  });

  it("centraliza o nome de item exatamente no ponto da barra", () => {
    const texto = desenhar(
      <TickCategoriaCentralizado
        x={120}
        y={60}
        payload={{ value: "CALÇA DE SARJA (CINZA)" }}
        maximo={18}
      />,
    );
    expect(texto.getAttribute("x")).toBe("120");
    expect(texto.getAttribute("text-anchor")).toBe("middle");
    expect(texto.querySelector("title")?.textContent).toBe("CALÇA DE SARJA (CINZA)");
  });

  it("não quebra quando o recharts não passa valor", () => {
    const texto = desenhar(<TickCategoria x={0} y={0} payload={{}} />);
    expect(texto.textContent).toBe("");
  });
});

describe("formatarEixoMoeda — eixo de valor sem zerar", () => {
  it("não transforma valor pequeno em zero", () => {
    // O formato antigo era Math.round(v / 1000) + "k": todo valor abaixo de
    // R$ 500 virava "0k", e o eixo do Saving por Contrato mostrava "0k" em
    // todas as marcas com barras visivelmente diferentes.
    expect(formatarEixoMoeda(0)).toBe("0");
    expect(formatarEixoMoeda(380)).toBe("380");
    expect(formatarEixoMoeda(950)).toBe("950");
    expect(new Set([0, 120, 380, 720].map(formatarEixoMoeda)).size).toBe(4);
  });

  it("compacta milhares e milhões", () => {
    expect(formatarEixoMoeda(1500)).toBe("1,5 mil");
    expect(formatarEixoMoeda(36_900)).toBe("37 mil");
    expect(formatarEixoMoeda(177_097)).toBe("177 mil");
    expect(formatarEixoMoeda(1_250_000)).toBe("1,3 mi");
  });

  it("aceita negativo e entrada inválida sem quebrar o eixo", () => {
    expect(formatarEixoMoeda(-2500)).toBe("-2,5 mil");
    expect(formatarEixoMoeda("abc" as unknown as number)).toBe("0");
  });
});
