import { describe, expect, it } from "vitest";
import {
  compraDiretaPorContrato, ehContratoEstoque, linhasPorContrato, montarConciliacao, montarPendencias, normalizarResposta, separarSaidas,
  type FisicoConciliacao, type SaidaContrato,
} from "@/pages/controladoria/conciliacao-estoque/regras";

// SIS-2026-0908: Conciliação de Estoque e Custo de Materiais.

const fisico = (f: Partial<FisicoConciliacao>): FisicoConciliacao => ({
  inicial: 0, entradas: 0, saidas: 0, final: 0, final_tela: null, entradas_sem_custo: 0, acertos_conhecidos: {}, ...f,
});
const saida = (id: string | null, nome: string, valor: number, unidades = 1): SaidaContrato => ({
  contrato_id: id, contrato_nome: nome, empresa_id: null, valor, unidades, unidades_sem_valor: 0,
});

describe("ehContratoEstoque", () => {
  it("casa os dois contratos de estoque de produção", () => {
    expect(ehContratoEstoque("ADMINISTRATIVO - HAGG ESTOQUE")).toBe(true);
    expect(ehContratoEstoque("ADMINISTRATIVO - SN ESTOQUE")).toBe(true);
    expect(ehContratoEstoque("Estoque Central")).toBe(true);
  });
  it("não casa o administrativo de verdade nem contrato de cliente", () => {
    expect(ehContratoEstoque("ADMINISTRATIVO - HAGG")).toBe(false);
    expect(ehContratoEstoque("ADMINISTRATIVO SÓCIOS - HELENA")).toBe(false);
    expect(ehContratoEstoque("UFRGS - CONTROLE DE ESTOQUE E LIMPEZA")).toBe(false);
  });
});

describe("montarConciliacao", () => {
  it("o exemplo do chamado: compra 100 mil, consumo 50 mil, estoque final 50 mil, diferença zero", () => {
    const c = montarConciliacao(100_000, fisico({ inicial: 0, entradas: 100_000, saidas: 50_000, final: 50_000 }))!;
    expect(c.estoqueContabilFinal).toBe(50_000);
    expect(c.estoqueFisicoFinal).toBe(50_000);
    expect(c.diferenca).toBe(0);
    expect(c.ok).toBe(true);
    // Compras = Estoque final + Consumido
    expect(c.compras).toBe(c.estoqueContabilFinal + c.saidas - c.estoqueInicial);
  });

  it("estoque inicial vindo da foto (carga do sistema antigo) fecha a identidade", () => {
    const c = montarConciliacao(20_000, fisico({ inicial: 740_000, entradas: 20_000, saidas: 60_000, final: 700_000 }))!;
    expect(c.estoqueContabilFinal).toBe(700_000);
    expect(c.ok).toBe(true);
  });

  it("compra que não entrou no almoxarifado vira diferença com nome", () => {
    const c = montarConciliacao(30_000, fisico({ inicial: 1_000, entradas: 10_000, saidas: 500, final: 10_500 }))!;
    expect(c.compraSemEntrada).toBe(20_000);
    expect(c.diferenca).toBe(20_000);
    expect(c.ok).toBe(false);
  });

  it("remoção sem registro aparece como acerto físico", () => {
    const c = montarConciliacao(200, fisico({ inicial: 1_000, entradas: 200, saidas: 350, final: 820 }))!;
    expect(c.acertosFisicos).toBe(-30);
    expect(c.diferenca).toBe(30);
  });

  it("sem foto no período não inventa conta", () => {
    expect(montarConciliacao(5_000, null)).toBeNull();
  });
});

describe("separarSaidas e linhasPorContrato", () => {
  const saidas = [
    saida("c1", "UFRGS - LIMPEZA", 300, 30),
    saida("adm", "ADMINISTRATIVO - HAGG", 50, 5),
    saida(null, "(sem contrato identificado)", 12, 2),
  ];
  it("separa contrato de cliente, administrativo e sem contrato", () => {
    const s = separarSaidas(saidas);
    expect(s.totalContratos).toBe(300);
    expect(s.totalAdministrativo).toBe(50);
    expect(s.totalSemContrato).toBe(12);
    expect(s.total).toBe(362);
  });
  it("compara a saída com a coluna da Lucratividade e aponta compra direta", () => {
    const s = separarSaidas(saidas);
    const l = linhasPorContrato(s.contratos, new Map([["c1", 300]]), new Map([["c1", 80]]));
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ saida: 300, apropriado: 300, diferenca: 0, compraDireta: 80, participacao: 1 });
  });
});

describe("compraDiretaPorContrato", () => {
  it("só soma classificação de material, fora dos contratos de estoque", () => {
    const m = compraDiretaPorContrato([
      { contrato_id: "c1", classificacao_nome: "UNIFORMES", valor: 100 },
      { contrato_id: "c1", classificacao_nome: "EPI'S", valor: 20 },
      { contrato_id: "c1", classificacao_nome: "SALÁRIOS", valor: 9_000 },
      { contrato_id: "est", classificacao_nome: "UNIFORMES", valor: 500 },
      { contrato_id: "c2", classificacao_nome: "MATERIAL DE LIMPEZA", valor: 30 },
    ], new Set(["est"]));
    expect(m.get("c1")).toBe(120);
    expect(m.get("c2")).toBe(30);
    expect(m.has("est")).toBe(false);
  });
});

describe("montarPendencias", () => {
  const limpo = () => {
    const s = separarSaidas([saida("c1", "UFRGS - LIMPEZA", 50_000)]);
    return {
      conciliacao: montarConciliacao(100_000, fisico({ entradas: 100_000, saidas: 50_000, final: 50_000 })),
      saidas: s,
      linhas: linhasPorContrato(s.contratos, new Map([["c1", 50_000]]), new Map()),
      estoqueSemCusto: { itens: 0, unidades: 0 },
      entradasSemCusto: 0,
    };
  };
  const nivel = (p: ReturnType<typeof montarPendencias>, chave: string) => p.find((x) => x.chave === chave)?.nivel;

  it("caso limpo: nenhuma pendência de atenção", () => {
    const p = montarPendencias(limpo());
    expect(p.filter((x) => x.nivel === "atencao")).toEqual([]);
    expect(nivel(p, "estoque_como_despesa")).toBe("info");
  });

  it("cada situação do chamado dispara no caso que a define", () => {
    const base = limpo();
    const s = separarSaidas([saida("c1", "UFRGS - LIMPEZA", 50_000), saida(null, "(sem contrato identificado)", 100)]);
    const p = montarPendencias({
      ...base,
      conciliacao: montarConciliacao(120_000, fisico({ entradas: 100_000, saidas: 50_100, final: 49_000 })),
      saidas: s,
      linhas: linhasPorContrato(s.contratos, new Map([["c1", 40_000]]), new Map([["c1", 5_000]])),
      estoqueSemCusto: { itens: 3, unidades: 40 },
    });
    expect(nivel(p, "comprado_sem_entrada")).toBe("atencao");
    expect(nivel(p, "baixa_sem_contrato")).toBe("atencao");
    expect(nivel(p, "saida_nao_apropriada")).toBe("atencao");
    expect(nivel(p, "financeiro_x_fisico")).toBe("atencao");
    expect(nivel(p, "duplicidade")).toBe("atencao");
    expect(nivel(p, "sem_custo")).toBe("atencao");
    expect(p.find((x) => x.chave === "saida_nao_apropriada")!.valor).toBe(10_000);
    expect(p.find((x) => x.chave === "duplicidade")!.valor).toBe(5_000);
  });
});

describe("normalizarResposta", () => {
  it("aceita numeric como texto (PostgREST) e resposta vazia", () => {
    expect(normalizarResposta(null)).toBeNull();
    const r = normalizarResposta({
      janela: { foto_inicial: "2026-11-17", fim_agora: true },
      fotos: ["2026-11-17"],
      fisico: { inicial: "1000.00", entradas: "200", saidas: "350.00", final: "820", final_tela: "902", entradas_sem_custo: 0, acertos_conhecidos: { remocao: { qtd: 3, valor: "30.00" } } },
      estoque_sem_custo: { itens: 1, unidades: 8 },
      saidas_por_contrato: [{ contrato_id: null, contrato_nome: "(sem contrato identificado)", valor: "0", unidades: 2, unidades_sem_valor: 2 }],
      itens: [],
    })!;
    expect(r.fisico).toMatchObject({ inicial: 1000, saidas: 350, final: 820, final_tela: 902 });
    expect(r.fisico!.acertos_conhecidos.remocao.valor).toBe(30);
    expect(r.saidas_por_contrato[0].unidades_sem_valor).toBe(2);
  });
});
