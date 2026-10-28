import { describe, expect, it } from "vitest";
import {
  chegaAtrasado,
  coberturaComTransito,
  coberturaDeValor,
  csvDaCompra,
  explicarAlvo,
  explicarCompra,
  faltaCronica,
  formatarDias,
  formatarMeses,
  formatarMoedaCurta,
  motivosDeDesconfianca,
  pesoSituacao,
  recadoDoPainel,
  rotuloClasse,
  rotuloFaltaHistorica,
  rotuloSituacao,
  type EstoqueSaudavelDados,
  type ItemEstoqueSaudavel,
  type PremissasEstoque,
} from "@/lib/suprimentos/estoqueSaudavel";

/**
 * Estoque Saudável — regras de leitura da aba.
 *
 * A MATEMÁTICA do alvo não é testada aqui: ela mora na RPC
 * `sup_estoque_saudavel` e foi conferida contra valores calculados à mão num
 * cluster Postgres descartável (CALÇA M: 150 peças em 172 dias = 0,8721/dia,
 * ponto de pedido 9, alvo 35). O que se testa neste arquivo é a camada que
 * transforma esses números em leitura — e, principalmente, as regras que
 * evitam que a tela afirme coisa errada: desconfiança do alvo, "pedir hoje já
 * chega atrasado" e o CSV que vai para a cotação.
 */

const PREMISSAS: PremissasEstoque = {
  lead_time_dias: 10,
  nivel_servico: 0.95,
  z: 1.645,
  ciclo_revisao_dias: 30,
  janela_meses: 6,
  meses_sem_giro_morto: 6,
  tolerancia_excesso: 0.2,
  janela_inicio: "2026-05-01",
  janela_fim: "2026-10-19",
  ultimo_mes_completo: "2026-09-30",
  dias_janela: 172,
};

function item(over: Partial<ItemEstoqueSaudavel> = {}): ItemEstoqueSaudavel {
  return {
    base_id: "b1",
    item: "CALCA",
    tamanho: "M",
    ordem: 30,
    tipo: "uniforme",
    disponivel: 20,
    reservado: 0,
    fisico: 20,
    em_transito: 0,
    demanda_janela: 150,
    demanda_mensal: 26.55,
    demanda_dia: 0.8721,
    saida_janela: 120,
    dp_mensal: 0,
    meses_completos: 5,
    lead_time_dias: 10,
    seguranca: 0,
    ponto_pedido: 9,
    alvo_calculado: 35,
    alvo: 35,
    minimo: 9,
    alvo_aprovado: null,
    minimo_aprovado: null,
    minimo_cadastrado: 2,
    comprar: 15,
    excesso: 0,
    cobertura_dias: 23,
    meses_sem_giro: 1,
    giro_anual: 15.92,
    ciclos_por_ano: 9.1,
    reposicoes: 0,
    ultima_reposicao: null,
    vezes_pedido: 5,
    vezes_faltou: 0,
    unidades_faltaram: 0,
    pct_falta: 0,
    ultima_falta: null,
    ultima_saida: "2026-09-15",
    ultimo_pedido: "2026-09-01",
    valor_unitario: 70,
    sem_preco: false,
    valor_em_estoque: 1400,
    valor_excesso: 0,
    valor_comprar: 1050,
    valor_consumo: 10500,
    classe_abc: "A",
    classe_xyz: "X",
    coef_variacao: 0,
    situacao: "saudavel",
    liquidar: false,
    liquidar_motivo: null,
    fora_do_plano: false,
    politica_observacao: null,
    aprovado_por: null,
    aprovado_em: null,
    ...over,
  };
}

describe("motivosDeDesconfianca", () => {
  it("não desconfia de item regular com histórico completo", () => {
    expect(motivosDeDesconfianca(item())).toEqual([]);
  });

  it("acusa histórico curto, mas só quando houve demanda", () => {
    expect(motivosDeDesconfianca(item({ meses_completos: 1 }))[0]).toMatch(/menos de dois meses/i);
    // Item que nunca foi pedido tem histórico curto por não existir demanda —
    // não é alvo provisório, é item sem demanda. Acusar aqui enche a tela de
    // aviso para todo item parado do catálogo.
    expect(motivosDeDesconfianca(item({ meses_completos: 1, demanda_janela: 0 }))).toEqual([]);
  });

  it("acusa demanda irregular, que é o caso em que o alvo infla", () => {
    const motivos = motivosDeDesconfianca(item({ classe_xyz: "Z" }));
    expect(motivos.some((m) => /irregular/i.test(m))).toBe(true);
  });

  it("acusa falta de preço só quando há peça em casa", () => {
    expect(motivosDeDesconfianca(item({ sem_preco: true, disponivel: 10 })).length).toBe(1);
    expect(motivosDeDesconfianca(item({ sem_preco: true, disponivel: 0 }))).toEqual([]);
  });

  it("acumula os motivos, porque eles não se excluem", () => {
    const motivos = motivosDeDesconfianca(
      item({ meses_completos: 1, classe_xyz: "Z", sem_preco: true, disponivel: 5 }),
    );
    expect(motivos).toHaveLength(3);
  });
});

describe("cobertura e atraso de reposição", () => {
  it("conta o que está em trânsito, que é o que decide se dá tempo", () => {
    expect(coberturaComTransito(item({ disponivel: 20, em_transito: 5 }))).toBe(29);
  });

  it("sem consumo não há cobertura a projetar", () => {
    expect(coberturaComTransito(item({ demanda_dia: 0 }))).toBeNull();
  });

  it("acusa atraso quando nem o que está vindo cobre o prazo de reposição", () => {
    // 3 em casa + 2 vindo = 5 peças / 0,8721 por dia ≈ 6 dias, menos que os 10
    // dias de reposição: pedir hoje já chega depois de a peça acabar.
    expect(chegaAtrasado(item({ disponivel: 3, em_transito: 2 }))).toBe(true);
    expect(chegaAtrasado(item({ disponivel: 20, em_transito: 0 }))).toBe(false);
  });

  it("item sem consumo nunca é 'atrasado' — não há o que atrasar", () => {
    expect(chegaAtrasado(item({ demanda_dia: 0, disponivel: 0 }))).toBe(false);
  });
});

describe("explicarAlvo", () => {
  it("abre a conta com os números do próprio item", () => {
    const texto = explicarAlvo(item(), PREMISSAS);
    expect(texto).toContain("26,6 por mês");
    expect(texto).toContain("40 dias");
    expect(texto).toContain("10 de reposição + 30 até a próxima compra");
    expect(texto).toContain("alvo de 35");
  });

  it("diz quando não há colchão de segurança, em vez de omitir a parcela", () => {
    expect(explicarAlvo(item({ seguranca: 0 }), PREMISSAS)).toContain("sem colchão de segurança");
  });

  it("mostra a parcela de segurança e o nível de serviço quando ela existe", () => {
    const texto = explicarAlvo(item({ seguranca: 33, alvo_calculado: 55 }), PREMISSAS);
    expect(texto).toContain("+ 33 de segurança");
    expect(texto).toContain("95%");
  });

  it("avisa quando alguém aprovou alvo diferente do calculado", () => {
    const texto = explicarAlvo(item({ alvo_aprovado: 60, alvo: 60 }), PREMISSAS);
    expect(texto).toContain("Alvo aprovado manualmente: 60");
  });
});

describe("explicarCompra", () => {
  it("mostra a subtração, incluindo o que já está vindo", () => {
    expect(explicarCompra(item({ alvo: 35, disponivel: 20, em_transito: 5, comprar: 10 }))).toBe(
      "Alvo 35 − 20 em casa − 5 em trânsito = comprar 10.",
    );
  });

  it("explica por que não há nada a comprar quando o trânsito já cobre", () => {
    expect(explicarCompra(item({ alvo: 35, disponivel: 20, em_transito: 20, comprar: 0 }))).toMatch(
      /já cobre o alvo/,
    );
  });
});

describe("recadoDoPainel", () => {
  const painel = (resumo: Partial<EstoqueSaudavelDados["resumo"]>): EstoqueSaudavelDados =>
    ({
      resumo: {
        itens_planejados: 10,
        valor_em_estoque: 0,
        unidades_em_estoque: 0,
        dinheiro_parado: 0,
        valor_morto: 0,
        unidades_mortas: 0,
        itens_em_falta: 0,
        itens_a_repor: 0,
        itens_em_excesso: 0,
        itens_saudaveis: 0,
        itens_mortos: 0,
        unidades_a_comprar: 0,
        valor_a_comprar: 0,
        itens_sem_preco: 0,
        alvos_aprovados: 0,
        cobertura_media_dias: null,
        demanda_mensal_total: 0,
        demanda_fora_de_escopo: 0,
        primeiro_movimento: null,
        ...resumo,
      },
    }) as EstoqueSaudavelDados;

  it("prioriza quem já está sem peça — é o prejuízo que o gerente quer evitar", () => {
    expect(recadoDoPainel(painel({ itens_em_falta: 3, itens_a_repor: 9, valor_morto: 50_000 }))).toMatch(
      /3 tamanhos estão sem nenhuma peça/,
    );
  });

  it("concorda em número no singular", () => {
    expect(recadoDoPainel(painel({ itens_em_falta: 1 }))).toContain("1 tamanho está");
    expect(recadoDoPainel(painel({ itens_a_repor: 1 }))).toContain("1 item está");
  });

  it("sem falta, cobra o dinheiro parado", () => {
    expect(recadoDoPainel(painel({ valor_morto: 4000 }))).toMatch(/R\$ 4 mil em itens sem giro/);
  });

  it("diz que está tudo certo quando está tudo certo", () => {
    expect(recadoDoPainel(painel({ itens_saudaveis: 10 }))).toMatch(/dentro do alvo/);
  });
});

describe("coberturaDeValor", () => {
  it("mede a fração do plano que tem preço cadastrado", () => {
    expect(coberturaDeValor({ itens_planejados: 200, itens_sem_preco: 50 })).toBe(75);
  });

  it("painel vazio não é 0% de cobertura — não há nada a cobrir", () => {
    expect(coberturaDeValor({ itens_planejados: 0, itens_sem_preco: 0 })).toBe(100);
  });
});

describe("formatação", () => {
  it("corta o número de dias onde ele deixa de informar", () => {
    expect(formatarDias(23)).toBe("23 dias");
    expect(formatarDias(5000)).toBe("+999 dias");
    expect(formatarDias(null)).toBe("—");
    expect(formatarDias(0)).toBe("0 dias");
  });

  it("escreve meses por extenso, com o caso de 'este mês'", () => {
    expect(formatarMeses(0)).toBe("este mês");
    expect(formatarMeses(1)).toBe("1 mês");
    expect(formatarMeses(10)).toBe("10 meses");
    expect(formatarMeses(null)).toBe("—");
  });

  it("encurta dinheiro para caber em cartão", () => {
    expect(formatarMoedaCurta(4650)).toBe("R$ 4,7 mil");
    expect(formatarMoedaCurta(1_250_000)).toBe("R$ 1,3 mi");
    expect(formatarMoedaCurta(250)).toBe("R$ 250,00");
  });

  it("junta ABC e XYZ, tolerando classe ausente", () => {
    expect(rotuloClasse(item())).toBe("AX");
    expect(rotuloClasse(item({ classe_abc: "C", classe_xyz: null }))).toBe("C");
    expect(rotuloClasse(item({ classe_abc: null, classe_xyz: null }))).toBe("—");
  });

  it("fala a língua da operação, não a do estoque", () => {
    expect(rotuloSituacao("falta")).toBe("Faltando agora");
    expect(rotuloSituacao("repor")).toBe("Vai faltar");
    expect(rotuloSituacao("morto")).toBe("Sem giro");
  });
});

describe("pesoSituacao", () => {
  it("põe o risco de parar gente na frente de tudo", () => {
    expect(pesoSituacao("falta")).toBeLessThan(pesoSituacao("repor"));
    expect(pesoSituacao("repor")).toBeLessThan(pesoSituacao("excesso"));
    expect(pesoSituacao("saudavel")).toBeLessThan(pesoSituacao("fora_do_plano"));
  });

  it("situação desconhecida vai para o fim, não para o começo", () => {
    expect(pesoSituacao("algo_novo" as never)).toBeGreaterThanOrEqual(pesoSituacao("fora_do_plano"));
  });
});

describe("csvDaCompra", () => {
  it("leva só o que há para comprar, do maior valor para o menor", () => {
    const csv = csvDaCompra([
      item({ item: "CAMISA", tamanho: "P", comprar: 10, valor_comprar: 400 }),
      item({ item: "CALCA", tamanho: "G", comprar: 50, valor_comprar: 3500 }),
      item({ item: "MOLETOM", tamanho: "M", comprar: 0, valor_comprar: 0 }),
    ]);
    const linhas = csv.split("\r\n");
    expect(linhas[0]).toContain("Comprar");
    expect(linhas).toHaveLength(3); // cabeçalho + 2 linhas com compra
    expect(linhas[1]).toContain("CALCA");
    expect(linhas[2]).toContain("CAMISA");
  });

  it("não manda para a cotação item fora do plano nem marcado para liquidar", () => {
    const csv = csvDaCompra([
      item({ item: "GORRO", comprar: 5, fora_do_plano: true }),
      item({ item: "AVENTAL", comprar: 5, liquidar: true }),
    ]);
    expect(csv.split("\r\n")).toHaveLength(1); // só o cabeçalho
  });

  it("protege o ponto e vírgula do nome do item, que quebraria a coluna", () => {
    const csv = csvDaCompra([item({ item: 'CALCA; BRIM "PESADO"', comprar: 1, valor_comprar: 70 })]);
    expect(csv.split("\r\n")[1]).toContain('"CALCA; BRIM ""PESADO"""');
  });

  it("usa vírgula decimal, porque o arquivo abre no Excel em português", () => {
    const csv = csvDaCompra([item({ comprar: 15, demanda_mensal: 26.55, valor_comprar: 1050.5 })]);
    const linha = csv.split("\r\n")[1];
    expect(linha).toContain("26,55");
    expect(linha).toContain("1050,5");
  });
});

/* ------------------------------------------------------------------ */
/* Histórico de falta — o pedido de 20/10/2026                        */
/* ------------------------------------------------------------------ */

describe("rotuloFaltaHistorica", () => {
  it("não diz nada quando o item nunca faltou", () => {
    expect(rotuloFaltaHistorica(item({ vezes_faltou: 0, vezes_pedido: 5 }))).toBeNull();
  });

  it("conta as vezes e o percentual", () => {
    expect(rotuloFaltaHistorica(item({ vezes_faltou: 2, vezes_pedido: 5, pct_falta: 40 }))).toBe(
      "Já faltou 2 de 5 pedidos (40%)",
    );
  });

  it("concorda em número com um pedido só", () => {
    expect(rotuloFaltaHistorica(item({ vezes_faltou: 1, vezes_pedido: 1, pct_falta: 100 }))).toBe(
      "Já faltou 1 de 1 pedido (100%)",
    );
  });
});

describe("faltaCronica", () => {
  it("exige repetição E proporção — cada critério sozinho mente", () => {
    // 1 falta em 1 pedido dá 100%, e não é crônico: é um caso.
    expect(faltaCronica(item({ vezes_faltou: 1, vezes_pedido: 1, pct_falta: 100 }))).toBe(false);
    // 2 faltas em 90 pedidos é ruído de operação.
    expect(faltaCronica(item({ vezes_faltou: 2, vezes_pedido: 90, pct_falta: 2.2 }))).toBe(false);
    // 2 faltas em 5 pedidos é alvo errado.
    expect(faltaCronica(item({ vezes_faltou: 2, vezes_pedido: 5, pct_falta: 40 }))).toBe(true);
  });

  it("item que nunca faltou não é crônico", () => {
    expect(faltaCronica(item())).toBe(false);
  });
});

describe("recadoDoPainel com falta histórica", () => {
  const base = {
    itens_planejados: 10,
    valor_em_estoque: 0,
    unidades_em_estoque: 0,
    dinheiro_parado: 0,
    valor_morto: 0,
    unidades_mortas: 0,
    itens_em_falta: 0,
    itens_a_repor: 0,
    itens_em_excesso: 0,
    itens_saudaveis: 0,
    itens_mortos: 0,
    unidades_a_comprar: 0,
    valor_a_comprar: 0,
    itens_que_faltaram: 0,
    pedidos_nao_atendidos: 0,
    itens_sem_preco: 0,
    alvos_aprovados: 0,
    cobertura_media_dias: null,
    demanda_mensal_total: 0,
    demanda_fora_de_escopo: 0,
    primeiro_movimento: null,
  };
  const painel = (resumo: Partial<typeof base>) =>
    ({ resumo: { ...base, ...resumo } }) as EstoqueSaudavelDados;

  it("sem aperto hoje, cobra o alvo de quem já deixou pedido na mão", () => {
    expect(recadoDoPainel(painel({ itens_que_faltaram: 4, valor_morto: 9000 }))).toMatch(
      /4 tamanhos já deixaram pedido sem atendimento/,
    );
  });

  it("falta de hoje continua vindo antes da falta do passado", () => {
    expect(
      recadoDoPainel(painel({ itens_em_falta: 2, itens_que_faltaram: 9 })),
    ).toMatch(/sem nenhuma peça em casa/);
  });
});
