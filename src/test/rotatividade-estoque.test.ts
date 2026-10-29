import { describe, expect, it } from "vitest";
import {
  avisoMovimento,
  classeSituacaoCobertura,
  classeSituacaoGiro,
  combinarRotatividadeEstoque,
  coberturaDePreco,
  compararGrade,
  escalaDoTamanho,
  formatarCobertura,
  formatarGap,
  formatarGiro,
  maiorDesalinhamento,
  situacaoCobertura,
  situacaoGiro,
  somenteLetras,
  type RotatividadeEstoqueDados,
  type RotatividadeEstoqueDetalhe,
  type TamanhoRotatividade,
} from "@/lib/suprimentos/rotatividadeEstoque";

/** Linha de tamanho com os campos que cada teste precisa, resto no zero. */
function linha(parcial: Partial<TamanhoRotatividade>): TamanhoRotatividade {
  return {
    tamanho: "M",
    ordem: 30,
    pedidas: 0,
    valor_pedido: 0,
    entradas: 0,
    saidas: 0,
    devolucoes: 0,
    saldo_disponivel: 0,
    reservado: 0,
    giro: null,
    dias_cobertura: null,
    pct_pedidas: 0,
    declarado_pessoas: 0,
    pct_declarado: 0,
    ...parcial,
  };
}

describe("rotatividade do estoque — escala de tamanho", () => {
  it("separa escala de letra da numeração de calçado pela ordem da RPC", () => {
    expect(escalaDoTamanho(10)).toBe("letra"); // PP
    expect(escalaDoTamanho(71)).toBe("letra"); // EXGG
    expect(escalaDoTamanho(1036)).toBe("numero"); // 36
    expect(escalaDoTamanho(9000)).toBe("numero"); // rótulo fora de escala
  });

  it("filtra só a escala de letra, que é a comparável com a grade declarada", () => {
    const linhas = [
      linha({ tamanho: "M", ordem: 30 }),
      linha({ tamanho: "38", ordem: 1038 }),
      linha({ tamanho: "GG", ordem: 50 }),
    ];
    expect(somenteLetras(linhas).map((l) => l.tamanho)).toEqual(["M", "GG"]);
  });
});

describe("rotatividade do estoque — situação de giro", () => {
  it("distingue tamanho parado de tamanho que nunca teve movimento", () => {
    // Tem estoque e não saiu: dinheiro parado na prateleira.
    expect(situacaoGiro(linha({ saidas: 0, saldo_disponivel: 120 }))).toBe("parado");
    // Não saiu porque nunca entrou: não é problema de rotatividade.
    expect(situacaoGiro(linha({ saidas: 0, saldo_disponivel: 0 }))).toBe("sem_saida");
  });

  it("classifica as faixas de giro pelos limiares", () => {
    expect(situacaoGiro(linha({ saidas: 10, saldo_disponivel: 100, giro: 0.1 }))).toBe("lento");
    expect(situacaoGiro(linha({ saidas: 40, saldo_disponivel: 100, giro: 0.4 }))).toBe("saudavel");
    expect(situacaoGiro(linha({ saidas: 200, saldo_disponivel: 100, giro: 2 }))).toBe("acelerado");
  });

  it("trata o limiar como piso fechado, sem faixa sem classificação", () => {
    expect(situacaoGiro(linha({ saidas: 25, saldo_disponivel: 100, giro: 0.25 }))).toBe("saudavel");
    expect(situacaoGiro(linha({ saidas: 100, saldo_disponivel: 100, giro: 1 }))).toBe("acelerado");
  });

  it("dá uma cor distinta para cada situação, e nunca a mesma para duas", () => {
    const situacoes = ["sem_saida", "parado", "lento", "saudavel", "acelerado"] as const;
    const classes = situacoes.map((s) => classeSituacaoGiro(s));
    expect(new Set(classes).size).toBe(situacoes.length);
  });
});

describe("rotatividade do estoque — cobertura em dias", () => {
  it("não projeta cobertura sem consumo no período", () => {
    // Sem saída não há consumo diário para dividir: indefinida, não infinita.
    expect(situacaoCobertura(linha({ saldo_disponivel: 500, saidas: 0, dias_cobertura: null }))).toBe(
      "indefinida",
    );
  });

  it("aponta risco de falta e estoque alto pelos limiares", () => {
    expect(situacaoCobertura(linha({ saldo_disponivel: 10, saidas: 50, dias_cobertura: 12 }))).toBe(
      "risco",
    );
    expect(situacaoCobertura(linha({ saldo_disponivel: 300, saidas: 50, dias_cobertura: 90 }))).toBe(
      "adequado",
    );
    // Caso real medido em produção: P com 1.741 em estoque e 182 saídas.
    expect(situacaoCobertura(linha({ saldo_disponivel: 1741, saidas: 182, dias_cobertura: 2736 }))).toBe(
      "alto",
    );
  });

  it("marca sem estoque antes de qualquer conta de cobertura", () => {
    expect(situacaoCobertura(linha({ saldo_disponivel: 0, saidas: 90, dias_cobertura: 0 }))).toBe(
      "sem_estoque",
    );
  });

  it("corta o número de cobertura onde ele deixa de informar", () => {
    expect(formatarCobertura(758)).toBe("758 dias");
    expect(formatarCobertura(2736)).toBe("+999 dias");
    expect(formatarCobertura(null)).toBe("—");
  });

  it("dá uma cor distinta para cada situação de cobertura", () => {
    const situacoes = ["sem_estoque", "risco", "adequado", "alto", "indefinida"] as const;
    const classes = situacoes.map((s) => classeSituacaoCobertura(s));
    expect(new Set(classes).size).toBe(situacoes.length);
  });
});

describe("rotatividade do estoque — grade declarada x saída real", () => {
  const linhas = [
    // Números reais de 2026 (categoria uniforme, ano acumulado).
    linha({ tamanho: "P", ordem: 20, pedidas: 546, pct_pedidas: 11.8, declarado_pessoas: 447, pct_declarado: 11 }),
    linha({ tamanho: "M", ordem: 30, pedidas: 1249, pct_pedidas: 27, declarado_pessoas: 1134, pct_declarado: 29 }),
    linha({ tamanho: "G", ordem: 40, pedidas: 1203, pct_pedidas: 26, declarado_pessoas: 1157, pct_declarado: 30 }),
    linha({ tamanho: "EXGG", ordem: 71, pedidas: 115, pct_pedidas: 2.5, declarado_pessoas: 0, pct_declarado: 0 }),
    linha({ tamanho: "38", ordem: 1038, pedidas: 101, pct_pedidas: 2.2 }),
  ];

  it("compara em ponto percentual e mantém a ordem da escala", () => {
    const comparativo = compararGrade(linhas);
    expect(comparativo.map((l) => l.tamanho)).toEqual(["P", "M", "G", "EXGG"]);
    expect(comparativo.find((l) => l.tamanho === "G")?.gap).toBe(-4);
    expect(comparativo.find((l) => l.tamanho === "P")?.gap).toBe(0.8);
  });

  it("deixa a numeração de calçado fora do comparativo", () => {
    // Calçado tem escala própria; comparar "38" com a grade de vestuário na
    // mesma barra não significaria nada.
    expect(compararGrade(linhas).some((l) => l.tamanho === "38")).toBe(false);
  });

  it("descarta tamanho sem nenhum lado preenchido", () => {
    const vazio = [linha({ tamanho: "PP", ordem: 10, pedidas: 0, pct_pedidas: 0 })];
    expect(compararGrade(vazio)).toEqual([]);
  });

  it("ignora rótulo que o formulário não oferece ao buscar o maior desvio", () => {
    // EXGG tem o gap bruto maior (+2,5), mas ninguém pôde declará-lo: isso é
    // grade de formulário desalinhada do catálogo, e já tem alerta próprio.
    const maior = maiorDesalinhamento(compararGrade(linhas));
    expect(maior?.tamanho).toBe("G");
    expect(maior?.gap).toBe(-4);
  });

  it("devolve nulo quando nenhum tamanho tem declaração", () => {
    const semDeclaracao = [linha({ tamanho: "M", ordem: 30, pedidas: 10, pct_pedidas: 100 })];
    expect(maiorDesalinhamento(compararGrade(semDeclaracao))).toBeNull();
  });

  it("formata a diferença em ponto percentual com o sinal", () => {
    expect(formatarGap(3.2)).toBe("+3,2 p.p.");
    expect(formatarGap(-4)).toBe("−4,0 p.p.");
    expect(formatarGap(0)).toBe("0,0 p.p.");
  });
});

describe("rotatividade do estoque — honestidade dos números na tela", () => {
  it("avisa quando o período pedido começa antes do controle de almoxarifado", () => {
    // Pedidos existem desde março/2026; movimento físico só desde 04/08/2026.
    const aviso = avisoMovimento("2026-01-01", "2026-08-04");
    expect(aviso).toContain("04/08/2026");
    expect(aviso).toContain("almoxarifado");
  });

  it("não avisa quando o período inteiro tem movimento registrado", () => {
    expect(avisoMovimento("2026-09-01", "2026-08-04")).toBeNull();
    expect(avisoMovimento("2026-08-04", "2026-08-04")).toBeNull();
  });

  it("não avisa quando não há movimento nenhum para comparar", () => {
    expect(avisoMovimento("2026-01-01", null)).toBeNull();
  });

  it("expõe a cobertura de preço, porque o valor é estimado", () => {
    // Caso real: 5.085 unidades pedidas, 2.491 sem preço cadastrado.
    expect(coberturaDePreco({ unidades_pedidas: 5085, unidades_sem_preco: 2491 })).toBe(51);
    expect(coberturaDePreco({ unidades_pedidas: 100, unidades_sem_preco: 0 })).toBe(100);
    expect(coberturaDePreco({ unidades_pedidas: 0, unidades_sem_preco: 0 })).toBe(0);
  });

  it("não inventa giro onde a RPC não calculou", () => {
    expect(formatarGiro(null)).toBe("—");
    expect(formatarGiro(undefined)).toBe("—");
    expect(formatarGiro(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatarGiro(0.38)).toBe("0,38×");
    expect(formatarGiro(2)).toBe("2,00×");
  });
});

describe("rotatividade do estoque — consultas executiva e detalhada", () => {
  it("recompõe o payload preservando o valor calculado pela visão executiva", () => {
    const base = {
      resumo: { saldo_fisico: 10, reservado: 2, saldo_disponivel: 8 },
      por_item_tamanho: [],
      por_peca: [
        {
          codigo: "0000101",
          peca: "LUVA DE LATEX AZUL",
          pedidas: 12,
          valor_pedido: 345.67,
          entradas: 10,
          saidas: 4,
          saldo_disponivel: 6,
          tamanho_top: "M",
          giro: 0.67,
        },
      ],
    } as RotatividadeEstoqueDados;
    const detalhe = {
      resumo: { saldo_fisico: 11, reservado: 1, saldo_disponivel: 10 },
      por_item_tamanho: [
        {
          codigo: "0002052",
          item: "LUVA DE LATEX AZUL",
          tamanho: "M",
          pedidas: 12,
          entradas: 10,
          saidas: 4,
          fisico: 11,
          reservado: 1,
          saldo_disponivel: 10,
          cadastro_ativo: true,
          giro: 0.4,
        },
      ],
      por_peca: [
        {
          codigo: "0002052",
          peca: "LUVA DE LATEX AZUL",
          pedidas: 12,
          valor_pedido: 0,
          entradas: 10,
          saidas: 4,
          saldo_disponivel: 10,
          tamanho_top: "M",
          giro: 0.4,
        },
      ],
    } satisfies RotatividadeEstoqueDetalhe;

    const combinado = combinarRotatividadeEstoque(base, detalhe);

    expect(combinado.resumo).toEqual(expect.objectContaining({
      saldo_fisico: 11,
      reservado: 1,
      saldo_disponivel: 10,
    }));
    expect(combinado.por_item_tamanho[0].codigo).toBe("0002052");
    expect(combinado.por_peca[0]).toEqual(expect.objectContaining({
      codigo: "0002052",
      valor_pedido: 345.67,
    }));
  });
});
